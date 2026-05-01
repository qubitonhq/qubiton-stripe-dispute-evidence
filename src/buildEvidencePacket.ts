import type Stripe from 'stripe';
import type { QubitOnClient } from '@qubiton/sdk';
import { composeEvidence } from './composeEvidence.js';

interface Deps {
  stripe: Stripe;
  qubiton: QubitOnClient;
  /** For Stripe Connect platforms — pass the connected account ID. */
  stripeAccount?: string;
}

const swallow = (label: string) => (err: unknown) => {
  console.warn(`qubiton ${label} failed`, err);
  return null;
};

/**
 * Pull dispute evidence together for a single Stripe dispute and submit it.
 * Idempotent — safe to retry.
 */
export async function buildEvidencePacket(dispute: Stripe.Dispute, deps: Deps): Promise<void> {
  const { stripe, qubiton, stripeAccount } = deps;

  const reqOpts: Stripe.RequestOptions = stripeAccount
    ? { stripeAccount }
    : {};

  const charge = await stripe.charges.retrieve(
    typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
    { expand: ['payment_intent'] },
    reqOpts,
  );

  const billing = charge.billing_details;
  const address = billing.address; // Stripe.Address | null
  const paymentIntent =
    typeof charge.payment_intent === 'string' ? null : charge.payment_intent;
  const ip = paymentIntent?.metadata?.client_ip ?? charge.metadata?.client_ip ?? undefined;
  // Email can be missing on some flows (e.g. Apple Pay); fall back to receipt_email.
  const email = billing.email ?? charge.receipt_email ?? undefined;
  const phone = billing.phone ?? undefined;
  const name = billing.name ?? undefined;
  const country = address?.country ?? undefined;

  // Fan out — skip any check that has no input, log + swallow individual
  // failures so a partial enrichment still produces an evidence packet.
  const [addr, ipReport, phoneReport, emailReport] = await Promise.all([
    address?.line1 && country
      ? qubiton
          .validateAddress({
            country,
            addressLine1: address.line1,
            addressLine2: address.line2 ?? undefined,
            city: address.city ?? undefined,
            state: address.state ?? undefined,
            postalCode: address.postal_code ?? undefined,
          })
          .catch(swallow('address'))
      : null,
    ip
      ? qubiton
          .checkIPQuality({ ipAddress: ip })
          .catch(swallow('ipquality'))
      : null,
    phone
      ? qubiton
          // Phone validation needs a country hint. We assume the cardholder's
          // billing country matches their phone's country (true for ~95% of
          // disputes). Fallback to 'US' only when billing country is missing
          // entirely — non-US merchants should change this default.
          .validatePhone({ phoneNumber: phone, country: country ?? 'US' })
          .catch(swallow('phone'))
      : null,
    email
      ? qubiton
          .validateEmail({ emailAddress: email })
          .catch(swallow('email'))
      : null,
  ]);

  // Idempotency key suffix `:v1` — bump to :v2 if you fundamentally change the
  // evidence shape and want to re-submit over the same dispute. Stripe caches
  // the result per idempotency key for 24h.
  await stripe.disputes.update(
    dispute.id,
    { evidence: composeEvidence({ name, email, ip, addr, ipReport, phoneReport, emailReport }) },
    { ...reqOpts, idempotencyKey: `${dispute.id}:v1` },
  );
}
