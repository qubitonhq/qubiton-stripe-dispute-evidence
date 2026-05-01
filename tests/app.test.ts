import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type Stripe from 'stripe';
import { createApp } from '../src/app.js';

/**
 * Webhook-layer tests with mocked Stripe client and an inert QubitOn client.
 * Uses supertest so requests go via in-memory dispatch — no real socket,
 * no ephemeral-port leaks, no flaky cleanup paths. The `buildEvidencePacket`
 * internals are covered in their own suite — here we focus on the Express
 * integration.
 */

interface MakeOpts {
  constructEventResult?: Stripe.Event;
  constructEventThrows?: boolean;
}

function makeAppDeps(opts: MakeOpts = {}) {
  const constructEvent = vi.fn();
  if (opts.constructEventThrows) {
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
  } else if (opts.constructEventResult) {
    constructEvent.mockReturnValue(opts.constructEventResult);
  }

  const chargesRetrieve = vi.fn().mockResolvedValue({
    id: 'ch_test',
    billing_details: { name: null, email: null, phone: null, address: null },
    payment_intent: null,
    metadata: {},
    receipt_email: null,
  });
  const disputesUpdate = vi.fn().mockResolvedValue({ id: 'dp_test' });

  const stripe = {
    webhooks: { constructEvent },
    charges: { retrieve: chargesRetrieve },
    disputes: { update: disputesUpdate },
  } as unknown as Stripe;

  const qubiton = {
    validateAddress: vi.fn().mockResolvedValue(null),
    checkIPQuality: vi.fn().mockResolvedValue(null),
    validatePhone: vi.fn().mockResolvedValue(null),
    validateEmail: vi.fn().mockResolvedValue(null),
  } as never;

  const tracked: Promise<void>[] = [];
  const track = vi.fn((p: Promise<void>) => {
    tracked.push(p);
  });
  const inflightCount = vi.fn(() => tracked.length);

  return {
    stripe,
    qubiton,
    deps: { stripe, qubiton, webhookSecret: 'whsec_test', track, inflightCount },
    constructEvent,
    chargesRetrieve,
    disputesUpdate,
    track,
    inflightCount,
    tracked,
  };
}

describe('createApp', () => {
  it('GET /healthz returns 200 with inflight count', async () => {
    const { deps, inflightCount } = makeAppDeps();
    inflightCount.mockReturnValueOnce(3);
    const app = createApp(deps);

    const r = await request(app).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, inflight: 3 });
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const { deps } = makeAppDeps();
    const app = createApp(deps);

    const r = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .send('{}');
    expect(r.status).toBe(400);
    expect(r.text).toMatch(/missing stripe-signature/i);
  });

  it('returns 400 when signature verification throws', async () => {
    const { deps, constructEvent } = makeAppDeps({ constructEventThrows: true });
    const app = createApp(deps);

    const r = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=123,v1=bad')
      .send('{}');
    expect(r.status).toBe(400);
    expect(r.text).toMatch(/Invalid signature/);
    expect(constructEvent).toHaveBeenCalledOnce();
  });

  it('returns 200 immediately and tracks async work for charge.dispute.created', async () => {
    const event = {
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_test', charge: 'ch_test' } },
      account: undefined,
    } as unknown as Stripe.Event;
    const { deps, track, chargesRetrieve, disputesUpdate, tracked } = makeAppDeps({
      constructEventResult: event,
    });
    const app = createApp(deps);

    const r = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=ok')
      .send('{}');
    expect(r.status).toBe(200);
    expect(track).toHaveBeenCalledOnce();
    // Wait for the background promise so we can assert the downstream calls fired
    await Promise.allSettled(tracked);
    expect(chargesRetrieve).toHaveBeenCalledOnce();
    expect(disputesUpdate).toHaveBeenCalledOnce();
  });

  it('returns 200 but does NOT trigger work for unrelated event types', async () => {
    const event = {
      type: 'charge.refunded',
      data: { object: { id: 'ch_test' } },
      account: undefined,
    } as unknown as Stripe.Event;
    const { deps, track, chargesRetrieve } = makeAppDeps({ constructEventResult: event });
    const app = createApp(deps);

    const r = await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=ok')
      .send('{}');
    expect(r.status).toBe(200);
    expect(track).not.toHaveBeenCalled();
    expect(chargesRetrieve).not.toHaveBeenCalled();
  });

  it('threads event.account through to buildEvidencePacket on Connect events', async () => {
    const event = {
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_test', charge: 'ch_test' } },
      account: 'acct_connected_123',
    } as unknown as Stripe.Event;
    const { deps, chargesRetrieve, tracked } = makeAppDeps({ constructEventResult: event });
    const app = createApp(deps);

    await request(app)
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=ok')
      .send('{}');
    await Promise.allSettled(tracked);

    // charges.retrieve is called with (id, params, opts); opts should carry stripeAccount
    const opts = chargesRetrieve.mock.calls[0]![2];
    expect(opts).toEqual({ stripeAccount: 'acct_connected_123' });
  });
});
