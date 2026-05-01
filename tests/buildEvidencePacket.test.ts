import { describe, it, expect, vi } from 'vitest';
import { buildEvidencePacket } from '../src/buildEvidencePacket.js';
import type Stripe from 'stripe';

/**
 * Integration-shaped tests with mocked Stripe + QubitOn clients. Verifies the
 * fan-out, the IP fallback chain, idempotency, and Stripe Connect threading
 * — all the wiring that the pure-logic tests can't reach.
 */

const sampleCharge = (overrides: Partial<Stripe.Charge> = {}): Partial<Stripe.Charge> => ({
  id: 'ch_test',
  object: 'charge',
  billing_details: {
    name: 'Jordan Reyes',
    email: 'jordan@gmail.com',
    phone: '+13125550118',
    address: {
      line1: '1742 N Damen Ave',
      line2: null,
      city: 'Chicago',
      state: 'IL',
      postal_code: '60647',
      country: 'US',
    },
    tax_id: null,
  } as Stripe.Charge.BillingDetails,
  payment_intent: {
    id: 'pi_test',
    object: 'payment_intent',
    metadata: { client_ip: '73.247.18.92' },
  } as unknown as Stripe.PaymentIntent,
  metadata: {},
  receipt_email: null,
  ...overrides,
});

function makeStripe(charge: Partial<Stripe.Charge>) {
  const update = vi.fn().mockResolvedValue({ id: 'dp_test', evidence: {} });
  const retrieve = vi.fn().mockResolvedValue(charge);
  return {
    stripe: {
      charges: { retrieve },
      disputes: { update },
    } as unknown as Stripe,
    update,
    retrieve,
  };
}

function makeQubiton() {
  const validateAddress = vi.fn().mockResolvedValue({
    address1: '1742 N Damen Ave',
    city: 'Chicago',
    state: 'IL',
    postalCode: '60647',
    country: { countryISO2: 'US' },
    isResidential: true,
    validationResults: [{ validationType: 'Address', validationPass: true }],
  });
  const checkIPQuality = vi.fn().mockResolvedValue({
    ipAddress: '73.247.18.92',
    isProxy: false,
    isVPN: false,
    isTOR: false,
    recentAbuse: false,
    isp: 'Comcast',
    city: 'Chicago',
    region: 'Illinois',
    connectionType: 'Residential',
    country: { countryISO2: 'US' },
  });
  const validatePhone = vi.fn().mockResolvedValue({
    validationResults: [
      {
        validationType: 'Phone',
        validationPass: true,
        additionalInfo: [
          { key: 'LineType', value: 'Mobile' },
          { key: 'Carrier', value: 'T-Mobile USA' },
        ],
      },
    ],
  });
  const validateEmail = vi.fn().mockResolvedValue({
    validationResults: [
      {
        validationType: 'Email',
        validationPass: true,
        additionalInfo: [
          { key: 'DomainCreatedDate', value: '09/15/2004 04:00:00' },
          { key: 'DnsValidationLevel', value: 'OK' },
        ],
      },
    ],
  });
  return {
    qubiton: { validateAddress, checkIPQuality, validatePhone, validateEmail } as never,
    validateAddress,
    checkIPQuality,
    validatePhone,
    validateEmail,
  };
}

const sampleDispute = (overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute => ({
  id: 'dp_test',
  charge: 'ch_test',
  ...overrides,
}) as Stripe.Dispute;

describe('buildEvidencePacket', () => {
  it('fans out all four QubitOn calls and submits a complete evidence packet', async () => {
    const { stripe, update, retrieve } = makeStripe(sampleCharge());
    const { qubiton, validateAddress, checkIPQuality, validatePhone, validateEmail } = makeQubiton();

    await buildEvidencePacket(sampleDispute(), { stripe, qubiton });

    expect(retrieve).toHaveBeenCalledWith(
      'ch_test',
      { expand: ['payment_intent'] },
      {},
    );
    expect(validateAddress).toHaveBeenCalledOnce();
    expect(checkIPQuality).toHaveBeenCalledWith({ ipAddress: '73.247.18.92' });
    expect(validatePhone).toHaveBeenCalledWith({
      phoneNumber: '+13125550118',
      country: 'US',
    });
    expect(validateEmail).toHaveBeenCalledWith({ emailAddress: 'jordan@gmail.com' });

    expect(update).toHaveBeenCalledOnce();
    const [disputeId, params, opts] = update.mock.calls[0]!;
    expect(disputeId).toBe('dp_test');
    expect(params.evidence.customer_name).toBe('Jordan Reyes');
    expect(params.evidence.customer_purchase_ip).toBe('73.247.18.92');
    expect(params.evidence.customer_email_address).toBe('jordan@gmail.com');
    expect(params.evidence.billing_address).toContain('1742 N Damen Ave');
    expect(opts.idempotencyKey).toBe('dp_test:v1');
    expect(opts.stripeAccount).toBeUndefined();
  });

  it('threads stripeAccount through both retrieve and update on Connect', async () => {
    const { stripe, update, retrieve } = makeStripe(sampleCharge());
    const { qubiton } = makeQubiton();

    await buildEvidencePacket(sampleDispute(), {
      stripe,
      qubiton,
      stripeAccount: 'acct_connected_123',
    });

    const retrieveOpts = retrieve.mock.calls[0]![2];
    expect(retrieveOpts).toEqual({ stripeAccount: 'acct_connected_123' });

    const updateOpts = update.mock.calls[0]![2];
    expect(updateOpts.stripeAccount).toBe('acct_connected_123');
    expect(updateOpts.idempotencyKey).toBe('dp_test:v1');
  });

  it('falls back from billing_details.email to charge.receipt_email', async () => {
    const charge = sampleCharge({
      billing_details: {
        ...sampleCharge().billing_details!,
        email: null,
      } as Stripe.Charge.BillingDetails,
      receipt_email: 'receipt@gmail.com',
    });
    const { stripe } = makeStripe(charge);
    const { qubiton, validateEmail } = makeQubiton();

    await buildEvidencePacket(sampleDispute(), { stripe, qubiton });

    expect(validateEmail).toHaveBeenCalledWith({ emailAddress: 'receipt@gmail.com' });
  });

  it('reads client_ip from charge.metadata when payment_intent is null (direct charges)', async () => {
    const charge = sampleCharge({
      payment_intent: null,
      metadata: { client_ip: '8.8.8.8' },
    });
    const { stripe } = makeStripe(charge);
    const { qubiton, checkIPQuality } = makeQubiton();

    await buildEvidencePacket(sampleDispute(), { stripe, qubiton });

    expect(checkIPQuality).toHaveBeenCalledWith({ ipAddress: '8.8.8.8' });
  });

  it('skips QubitOn calls that have no input and still submits evidence', async () => {
    const charge = sampleCharge({
      billing_details: {
        name: null,
        email: null,
        phone: null,
        address: null,
        tax_id: null,
      } as unknown as Stripe.Charge.BillingDetails,
      payment_intent: null,
      metadata: {},
      receipt_email: null,
    });
    const { stripe, update } = makeStripe(charge);
    const { qubiton, validateAddress, checkIPQuality, validatePhone, validateEmail } = makeQubiton();

    await buildEvidencePacket(sampleDispute(), { stripe, qubiton });

    expect(validateAddress).not.toHaveBeenCalled();
    expect(checkIPQuality).not.toHaveBeenCalled();
    expect(validatePhone).not.toHaveBeenCalled();
    expect(validateEmail).not.toHaveBeenCalled();

    // Still submitted — partial packet beats empty packet
    expect(update).toHaveBeenCalledOnce();
    const [, params] = update.mock.calls[0]!;
    expect(params.evidence.uncategorized_text).toContain('Address validates: —');
  });

  it('continues even if a QubitOn call rejects (partial enrichment)', async () => {
    const { stripe, update } = makeStripe(sampleCharge());
    const { qubiton, validateAddress } = makeQubiton();
    validateAddress.mockRejectedValueOnce(new Error('boom'));

    await buildEvidencePacket(sampleDispute(), { stripe, qubiton });

    expect(update).toHaveBeenCalledOnce();
    const [, params] = update.mock.calls[0]!;
    // Address typed field is undefined (validation failed) but typed customer fields still submitted
    expect(params.evidence.billing_address).toBeUndefined();
    expect(params.evidence.customer_name).toBe('Jordan Reyes');
    expect(params.evidence.customer_purchase_ip).toBe('73.247.18.92');
  });

  it('handles dispute.charge as an expanded Charge object (not just an ID)', async () => {
    const { stripe, retrieve } = makeStripe(sampleCharge());
    const { qubiton } = makeQubiton();

    const dispute = sampleDispute({
      charge: { id: 'ch_test_expanded' } as Stripe.Charge,
    });

    await buildEvidencePacket(dispute, { stripe, qubiton });

    expect(retrieve).toHaveBeenCalledWith(
      'ch_test_expanded',
      { expand: ['payment_intent'] },
      {},
    );
  });
});
