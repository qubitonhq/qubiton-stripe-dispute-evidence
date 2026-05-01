import express, { type Request, type Response, type Express } from 'express';
import type Stripe from 'stripe';
import type { QubitOnClient } from '@qubiton/sdk';
import { buildEvidencePacket } from './buildEvidencePacket.js';

export interface AppDeps {
  stripe: Stripe;
  qubiton: QubitOnClient;
  webhookSecret: string;
  /**
   * Optional callback to track in-flight async work for graceful shutdown.
   * Server-side wires this to the inflight Set; tests pass a no-op or stub.
   */
  track?: (p: Promise<void>) => void;
  /** Reports the count of currently in-flight evidence builds for /healthz. */
  inflightCount?: () => number;
}

/**
 * Build the Express app. Exported as a factory so tests can spin up the
 * webhook against mocked Stripe + QubitOn clients without going through
 * `process.env` or starting a real HTTP listener.
 */
export function createApp(deps: AppDeps): Express {
  const { stripe, qubiton, webhookSecret } = deps;
  // `track` and `inflightCount` defaults exist for tests — production
  // (server.ts) MUST pass real implementations so SIGTERM-driven drains
  // wait for in-flight evidence builds before exit. Without `track`,
  // dispute submissions can be cut off mid-call on rolling deploys.
  const track = deps.track ?? ((_p: Promise<void>) => undefined);
  const inflightCount = deps.inflightCount ?? (() => 0);

  const app = express();
  app.set('trust proxy', true);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, inflight: inflightCount() });
  });

  // Stripe requires the raw body to verify the webhook signature.
  // Mount express.raw() ONLY on this route — not globally.
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '256kb' }),
    (req: Request, res: Response) => {
      const sig = req.headers['stripe-signature'];
      if (typeof sig !== 'string') {
        res.status(400).send('Missing stripe-signature header');
        return;
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        res.status(400).send(`Invalid signature: ${msg}`);
        return;
      }

      // ACK immediately — Stripe retries on slow responses, so never block
      // the webhook on outbound calls. In production, push the dispute ID
      // onto a real job queue (BullMQ / SQS / similar) so transient failures
      // get retried with exponential backoff.
      res.status(200).end();

      if (event.type === 'charge.dispute.created') {
        const dispute = event.data.object;
        // For Stripe Connect platforms, event.account is the connected account ID.
        const stripeAccount = event.account ?? undefined;
        track(
          buildEvidencePacket(dispute, { stripe, qubiton, stripeAccount }).catch((err) =>
            console.error('evidence-build failed', { dispute: dispute.id, err }),
          ),
        );
      }
    },
  );

  return app;
}
