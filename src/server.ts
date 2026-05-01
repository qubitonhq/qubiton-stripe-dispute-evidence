import Stripe from 'stripe';
import { QubitOnClient } from '@qubiton/sdk';
import { required, intEnv } from './env.js';
import { createApp } from './app.js';

const STRIPE_SECRET_KEY = required('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = required('STRIPE_WEBHOOK_SECRET');
const QUBITON_API_KEY = required('QUBITON_API_KEY');
const PORT = intEnv('PORT', 3000);
const SHUTDOWN_TIMEOUT_MS = intEnv('SHUTDOWN_TIMEOUT_MS', 30_000);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });
const qubiton = new QubitOnClient({ apiKey: QUBITON_API_KEY });

// Track in-flight evidence builds so we can drain them on shutdown.
// Disputes that arrive during a deploy must finish submitting evidence
// before the process exits — otherwise the dispute auto-loses on deadline.
const inflight = new Set<Promise<void>>();

const app = createApp({
  stripe,
  qubiton,
  webhookSecret: STRIPE_WEBHOOK_SECRET,
  track: (p) => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
  },
  inflightCount: () => inflight.size,
});

const server = app.listen(PORT, () => {
  console.log(`stripe dispute webhook listening on :${PORT}`);
});

// Graceful shutdown: stop accepting new requests, drain in-flight evidence
// builds, then exit. Container orchestrators (Kubernetes, ECS, Fly, Render,
// etc.) send SIGTERM and wait grace-period seconds before SIGKILL — make
// sure your platform's grace period is >= SHUTDOWN_TIMEOUT_MS.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining ${inflight.size} in-flight evidence build(s)...`);

  // Stop accepting new connections; await existing sockets to finish.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));

  // Hard timeout in case any evidence build (or socket) hangs.
  const timeout = setTimeout(() => {
    console.error(`shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms with ${inflight.size} build(s) still running`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  await Promise.allSettled([closed, ...inflight]);
  console.log('drained, exiting cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
