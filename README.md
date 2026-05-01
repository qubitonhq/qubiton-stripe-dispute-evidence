# qubiton-stripe-dispute-evidence

[![CI](https://github.com/qubitonhq/qubiton-stripe-dispute-evidence/actions/workflows/ci.yml/badge.svg)](https://github.com/qubitonhq/qubiton-stripe-dispute-evidence/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/ghcr.io-qubiton--stripe--dispute--evidence-blue?logo=docker)](https://github.com/qubitonhq/qubiton-stripe-dispute-evidence/pkgs/container/qubiton-stripe-dispute-evidence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Auto-build Stripe chargeback dispute evidence packets via webhook, enriched with the [QubitOn API](https://www.qubiton.com).

> Companion repo for the article: **["The Stripe dispute that eats every merchant's weekend — and the 50-line webhook that prevents it"](https://www.qubiton.com/blog/stripe-dispute-evidence-packet)**

When Stripe fires `charge.dispute.created`, this server fans out four parallel calls to QubitOn (address validation, IP quality, phone validation, email validation), composes a structured evidence packet, and submits it back to Stripe via `disputes.update` — typically in under a second.

## What you get

| Signal | QubitOn endpoint | Stripe evidence field |
|---|---|---|
| Address validates + standardizes | `validateAddress` | `billing_address` |
| IP geolocation, VPN/proxy/Tor flags | `checkIPQuality` | `customer_purchase_ip` |
| Phone validity + line type / carrier | `validatePhone` | (markdown summary) |
| Email syntax + domain age + DNS | `validateEmail` | `customer_email_address` |

## Quickstart

### Option A — Docker (no clone needed)

Pull the prebuilt multi-arch image (linux/amd64 + linux/arm64) from GitHub Container Registry:

```bash
docker run --rm -p 3000:3000 \
  -e STRIPE_SECRET_KEY=sk_test_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e QUBITON_API_KEY=svm... \
  ghcr.io/qubitonhq/qubiton-stripe-dispute-evidence:latest
```

Available tags (pick the one that matches your update tolerance):

| Tag | Points to | Use when |
|---|---|---|
| `:latest` | head of `main` (moves) | local dev, hacking |
| `:main` | same as `:latest` | same |
| `:main-<sha>` | a specific commit on `main` | reproducible CI builds against a non-released snapshot |
| `:0.1.0` (or any `:X.Y.Z`) | the exact release tag — **immutable** | **production — pin here** |
| `:0.1` (or any `:X.Y`) | latest patch in that minor | want auto-patch updates, no minor bumps |
| `:0` (or any `:X`) | latest minor + patch in that major | want auto-minor + patch, no major bumps |
| `:v0.1.0` (full ref) | same as `:0.1.0` | for tooling that prefers the `v`-prefix form |

The image is **public** — no auth needed to pull.

### Option B — clone and run

```bash
git clone https://github.com/qubitonhq/qubiton-stripe-dispute-evidence.git
cd qubiton-stripe-dispute-evidence
npm install
cp .env.example .env
# edit .env with your Stripe and QubitOn keys
npm run dev
```

In a second terminal (either option):

```bash
stripe login                      # test-mode account, not live!
stripe listen --forward-to localhost:3000/webhooks/stripe
# copy the printed `whsec_...` signing secret into .env as STRIPE_WEBHOOK_SECRET
# in a third terminal:
stripe trigger charge.dispute.created
```

You'll see the webhook handler fire, the four QubitOn calls go out, and the evidence packet posted back to Stripe. Watch the dispute in your [test-mode Stripe Dashboard](https://dashboard.stripe.com/test/disputes) to see the submitted evidence.

## The one piece of plumbing nobody mentions

Stripe **does not store the customer's IP address on the Charge object**. You have to capture it at checkout and stash it on the PaymentIntent yourself, before the customer hits Pay. See [`src/checkout-example.ts`](./src/checkout-example.ts) for the pattern:

```ts
await stripe.paymentIntents.create({
  amount, currency,
  metadata: { client_ip: req.ip },
});
```

Without this, `customer_purchase_ip` evidence will be missing when a dispute opens later.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | `sk_test_...` — get from [test-mode dashboard](https://dashboard.stripe.com/test/apikeys) |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_...` — printed by `stripe listen` or set on a deployed webhook endpoint |
| `QUBITON_API_KEY` | yes | `svm...` — get a free key (100 calls/mo) at [qubiton.com](https://www.qubiton.com/auth/register) |
| `PORT` | no | HTTP port to listen on. Defaults to `3000`. |
| `SHUTDOWN_TIMEOUT_MS` | no | Graceful-shutdown drain timeout in ms. Defaults to `30000`. Must be `<=` your platform's `terminationGracePeriodSeconds` (Kubernetes / ECS / Fly / Render / etc.) — otherwise the platform SIGKILLs you mid-drain. |

## On Stripe Connect

If you're a platform using Connect, disputes live on the **connected account**, not the platform. The webhook handler in [`src/app.ts`](./src/app.ts) reads `event.account` from the Connect webhook payload and the orchestrator in [`src/buildEvidencePacket.ts`](./src/buildEvidencePacket.ts) threads it through `stripe.charges.retrieve` and `stripe.disputes.update` as `{ stripeAccount: connectedAcctId }`. Skip that on `charges.retrieve` and you'll get a 404 against the platform account.

## Architecture

```
Stripe webhook (charge.dispute.created)
   │
   ▼
server.ts                  ← reads env, listens, drains on SIGTERM
   │
   ▼  (createApp factory)
app.ts                     ← verifies Stripe signature, ACKs 200,
   │                          dispatches charge.dispute.created
   ▼
buildEvidencePacket.ts     ← retrieves charge, fans out 4 QubitOn calls
   │
   ├─ validateAddress      ← billing_address
   ├─ checkIPQuality       ← customer_purchase_ip
   ├─ validatePhone        ← (markdown summary)
   └─ validateEmail        ← customer_email_address
   │
   ▼
composeEvidence.ts         ← maps results to Stripe's typed evidence fields
   │
   ▼
renderMarkdown.ts          ← human-readable summary for uncategorized_text
   │
   ▼
stripe.disputes.update     ← idempotent submit (idempotencyKey = dispute.id:v1)
```

### Files at a glance

| File | Purpose |
|------|---------|
| `src/server.ts` | Reads env vars, builds the app, listens, handles SIGTERM/SIGINT drain |
| `src/app.ts` | Express factory `createApp(deps)` — signature verification + ACK + event dispatch (testable, no env coupling) |
| `src/env.ts` | `required()` and `intEnv()` — env-var parsing with explicit errors |
| `src/buildEvidencePacket.ts` | Charge retrieve → 4-way fan-out → Stripe submit |
| `src/composeEvidence.ts` | Build Stripe's typed evidence fields |
| `src/renderMarkdown.ts` | Human-readable markdown for `uncategorized_text` |
| `src/checkout-example.ts` | Standalone example: capture client IP at checkout |
| `src/types.ts` | Re-exports SDK types + local `EvidenceInputs` / `DisputeEvidence` |

## Development

```bash
npm run lint        # eslint v9 (flat config: eslint.config.js)
npm run typecheck   # tsc -p tsconfig.typecheck.json (covers src/ + tests/)
npm run test        # vitest run
npm run build       # tsc → dist/ (src/ only)
npm run ci          # lint + typecheck + test + build
```

## Deployment

### Docker

A multi-stage Dockerfile is included. The runtime image is `node:20-alpine`, runs as a non-root user, and exits cleanly on SIGTERM (drains in-flight evidence builds before exit).

```bash
docker build -t qubiton-stripe-dispute-evidence .
docker run --rm -p 3000:3000 \
  -e STRIPE_SECRET_KEY=sk_test_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e QUBITON_API_KEY=svm... \
  qubiton-stripe-dispute-evidence
```

### Kubernetes / managed runtimes (Render, Fly.io, Railway, ECS, Cloud Run, etc.)

Three things to get right:

1. **Set the env vars** from your secret manager — never commit them.
2. **Set the platform's grace period** (`terminationGracePeriodSeconds` on Kubernetes; equivalent on others) **>= `SHUTDOWN_TIMEOUT_MS` (default 30s)** so the in-flight evidence drain has time to complete on rolling deploys.
3. **Expose `/healthz`** as your readiness probe. It returns `{ ok: true, inflight: <count> }`.

### Webhook URL

Once deployed, register your public URL with Stripe:

1. [Stripe Dashboard → Developers → Webhooks → Add endpoint](https://dashboard.stripe.com/webhooks)
2. URL: `https://your-domain.com/webhooks/stripe`
3. Events: subscribe to at minimum `charge.dispute.created`. Add `charge.dispute.closed` to log outcomes.
4. Copy the **signing secret** (starts with `whsec_`) into `STRIPE_WEBHOOK_SECRET`.

### Capacity sizing

This webhook is I/O-bound — almost all wall-clock time is spent waiting on Stripe + QubitOn responses. A single Node process handles thousands of disputes per minute easily. Scale horizontally for redundancy, not throughput.

## Troubleshooting

### `Invalid signature: ...` on every webhook

- The `STRIPE_WEBHOOK_SECRET` doesn't match what Stripe is signing with. Re-copy it from `stripe listen` (local) or the Dashboard webhook endpoint (deployed).
- You're running `express.json()` *before* `express.raw()` for the webhook route. The signature check needs the raw bytes — `express.raw()` must be mounted **only** on `/webhooks/stripe`.
- Some proxies (e.g., older API gateway configs) re-serialize the body. Make sure the body reaches your handler byte-identical to what Stripe sent.

### `customer_purchase_ip` is always missing in submitted evidence

You forgot to capture the client IP at checkout. See [`src/checkout-example.ts`](./src/checkout-example.ts) — you have to stash `req.ip` into `paymentIntent.metadata.client_ip` (or `charge.metadata.client_ip` for direct charges) **before** the customer hits Pay. Stripe doesn't expose the IP on the Charge object on its own.

### `qubiton 401 Unauthorized` in the logs

`QUBITON_API_KEY` is missing, expired, or wrong. Get a fresh one at [qubiton.com/auth/register](https://www.qubiton.com/auth/register).

### `qubiton 422 provider info is not set for this apikey`

The capability you called isn't enabled on your API key. The four endpoints used here (`validateAddress`, `checkIPQuality`, `validatePhone`, `validateEmail`) are core and work on the free tier. If you extend this to use add-on capabilities (domain security report, beneficial ownership, etc.), you'll need a Pro or Enterprise plan.

### Disputes get a 200 ACK but no evidence is submitted

Check your logs for `evidence-build failed`. Common causes:

- Stripe API call rejected because of missing `stripeAccount` on Connect — the platform account doesn't have the connected account's charges visible.
- Network blip during one of the four QubitOn calls — the catch handler logs `qubiton {label} failed`. Partial enrichment should still submit; if nothing is submitted, the failure is in `stripe.disputes.update` itself.
- Process killed mid-build (deploy without graceful-shutdown grace-period). See "Kubernetes" above.

### Evidence submitted but the dispute still loses

- The bank's reviewer found something contradicting your evidence (e.g., the cardholder really didn't make the purchase).
- You're missing the highest-weight typed fields. `shipping_documentation` (tracking PDF) and `customer_communication` (order confirmation email) come from your fulfillment / email systems — pull them in alongside the QubitOn enrichment.
- The reason code requires evidence this starter doesn't generate (e.g., for "duplicate processing", you need `duplicate_charge_id`).
- For Visa fraud-CNP disputes (reason code 10.4), you may need [Compelling Evidence 3.0](https://docs.stripe.com/disputes/api/visa-ce3) — surfacing 2+ prior matching transactions from your own database. Out of scope for this starter.

## Production-readiness checklist

Before pointing this at live disputes, do these:

- [ ] **Wrap `buildEvidencePacket` in a real job queue** (BullMQ / SQS / Cloud Tasks). Today the call is fired-and-forgotten with `console.error` on failure — fine for a starter, not for production. Push the dispute ID onto the queue and let the worker handle retries.
- [ ] **Always submit *something*.** If a QubitOn call fails, still submit evidence with whatever signals you have (`customer_name`, `billing_address`, `customer_purchase_ip` from `billing_details`). A partial packet beats an empty one — never let an enrichment failure block the dispute response.
- [ ] **Add the other typed evidence fields you have.** `shipping_documentation` (tracking PDF) and `customer_communication` (order confirmation email) carry the highest weight in card-network decisioning. Pull them in from your fulfillment and email systems and add to the same `disputes.update` call.
- [ ] **Subscribe to `charge.dispute.closed`** to track outcomes (`won`, `lost`, `warning_closed`). Log them to your data warehouse so you can measure win rate.
- [ ] **For Visa fraud-CNP disputes (reason code 10.4)**, also consider [Visa Compelling Evidence 3.0](https://docs.stripe.com/disputes/api/visa-ce3) — surface 2+ prior matching transactions from the same payment method (120-364 days back, with at least two of: IP, device, shipping address, customer ID matching). Out of scope for this starter; PRs welcome.

## What this isn't

- **Not a replacement for Stripe Smart Disputes.** Run both — Stripe submits its evidence based on AVS / charge metadata / internal risk; this webhook adds external enrichment Stripe doesn't have.
- **Not card-network rules compliance.** This generates evidence; it doesn't certify your packets meet specific reason-code requirements (CE 3.0, Mastercard Pre-Arbitration, Amex Inquiry rebuttal). Read the network rules for your reason codes.
- **Not for non-card disputes.** BNPL (Klarna), wallets (PayPal, Cash App Pay), and bank-transfer flows (ACH, SEPA Direct Debit) have their own dispute shapes.

## License

[MIT](./LICENSE)
