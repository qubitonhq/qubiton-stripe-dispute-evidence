import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type Stripe from 'stripe';
import { isCheckoutBody, createCheckoutApp } from '../src/checkout-example.js';

describe('isCheckoutBody', () => {
  it('accepts a valid body', () => {
    expect(isCheckoutBody({ amount: 1000, currency: 'usd' })).toBe(true);
    expect(isCheckoutBody({ amount: 1, currency: 'EUR' })).toBe(true);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(isCheckoutBody(null)).toBe(false);
    expect(isCheckoutBody(undefined)).toBe(false);
    expect(isCheckoutBody('string')).toBe(false);
    expect(isCheckoutBody(42)).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isCheckoutBody({})).toBe(false);
    expect(isCheckoutBody({ amount: 1000 })).toBe(false);
    expect(isCheckoutBody({ currency: 'usd' })).toBe(false);
  });

  it('rejects amount that is not a positive integer', () => {
    expect(isCheckoutBody({ amount: '1000', currency: 'usd' })).toBe(false);
    expect(isCheckoutBody({ amount: -100, currency: 'usd' })).toBe(false);
    expect(isCheckoutBody({ amount: 0, currency: 'usd' })).toBe(false);
    expect(isCheckoutBody({ amount: 1.5, currency: 'usd' })).toBe(false);
    expect(isCheckoutBody({ amount: NaN, currency: 'usd' })).toBe(false);
  });

  it('rejects currency that is not a 3-letter code', () => {
    expect(isCheckoutBody({ amount: 1000, currency: 'us' })).toBe(false);
    expect(isCheckoutBody({ amount: 1000, currency: 'usdt' })).toBe(false);
    expect(isCheckoutBody({ amount: 1000, currency: '123' })).toBe(false);
    expect(isCheckoutBody({ amount: 1000, currency: '' })).toBe(false);
  });
});

describe('createCheckoutApp /checkout', () => {
  function makeStripe(piResult: Partial<Stripe.PaymentIntent> = { id: 'pi_test', client_secret: 'pi_test_secret' }) {
    const create = vi.fn().mockResolvedValue(piResult);
    const stripe = { paymentIntents: { create } } as unknown as Stripe;
    return { stripe, create };
  }

  it('returns 400 for an invalid body', async () => {
    const { stripe, create } = makeStripe();
    const app = createCheckoutApp(stripe);

    const r = await request(app)
      .post('/checkout')
      .set('content-type', 'application/json')
      .send({ amount: 'not-a-number', currency: 'usd' });

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/amount.*currency/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a PaymentIntent with client_ip in metadata when IP is present', async () => {
    const { stripe, create } = makeStripe();
    const app = createCheckoutApp(stripe);

    const r = await request(app)
      .post('/checkout')
      .set('content-type', 'application/json')
      // supertest sends from 127.0.0.1; with trust proxy enabled, req.ip resolves
      .send({ amount: 1000, currency: 'usd' });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ clientSecret: 'pi_test_secret' });
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0]![0] as Stripe.PaymentIntentCreateParams;
    expect(args.amount).toBe(1000);
    expect(args.currency).toBe('usd');
    // The metadata.client_ip should be set (req.ip from supertest is the loopback)
    expect(args.metadata).toBeDefined();
    expect(typeof args.metadata!.client_ip).toBe('string');
  });

});
