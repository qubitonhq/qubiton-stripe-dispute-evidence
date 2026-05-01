/**
 * Standalone example: capture the customer's IP at checkout and stash it on
 * the PaymentIntent. Stripe does NOT store the customer IP on the Charge
 * object — you have to do this yourself, or `customer_purchase_ip` evidence
 * will be missing when a dispute opens later.
 *
 * This file is illustrative only — wire the same pattern into your actual
 * checkout endpoint. It only auto-starts when RUN_CHECKOUT_EXAMPLE=1 is set,
 * so importing this module from tests or editor tooling has no side effects.
 *
 * `isCheckoutBody` and `createCheckoutApp` are exported for testability.
 */

import express, { type Express, type Request, type Response } from 'express';
import Stripe from 'stripe';

const CHECKOUT_PORT = Number(process.env.CHECKOUT_EXAMPLE_PORT ?? 3001);

export function isCheckoutBody(b: unknown): b is { amount: number; currency: string } {
  if (!b || typeof b !== 'object') return false;
  const x = b as Record<string, unknown>;
  return (
    typeof x.amount === 'number' &&
    Number.isInteger(x.amount) &&
    x.amount > 0 &&
    typeof x.currency === 'string' &&
    /^[a-z]{3}$/i.test(x.currency)
  );
}

export function createCheckoutApp(stripe: Stripe): Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());

  app.post('/checkout', async (req: Request, res: Response) => {
    if (!isCheckoutBody(req.body)) {
      res.status(400).json({ error: 'amount (positive integer) and currency (3-letter code) required' });
      return;
    }
    const { amount, currency } = req.body;

    // Only set client_ip if we actually have one — empty string is worse than missing.
    const metadata: Record<string, string> = {};
    if (req.ip) metadata.client_ip = req.ip;

    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata, // ← the client_ip stash is the whole trick
    });

    res.json({ clientSecret: pi.client_secret });
  });

  return app;
}

function startCheckoutExample(): void {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
  const app = createCheckoutApp(stripe);
  app.listen(CHECKOUT_PORT, () => console.log(`checkout example on :${CHECKOUT_PORT}`));
}

if (process.env.RUN_CHECKOUT_EXAMPLE === '1') {
  startCheckoutExample();
}
