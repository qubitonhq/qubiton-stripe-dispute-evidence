# Security Policy

## Reporting a vulnerability

If you find a security issue in this starter, **please report it privately** —
do not open a public GitHub issue or PR with details that could be exploited.

Two ways to report:

1. **GitHub Security Advisories (preferred)** —
   [open a private advisory](https://github.com/qubitonhq/qubiton-stripe-dispute-evidence/security/advisories/new).
   This is the standard GitHub workflow and gives us a coordinated-disclosure
   timeline before details go public.

2. **Email** — `security@qubiton.com`. Include:
   - A description of the issue
   - Steps to reproduce
   - The version / commit you tested against
   - Any proof-of-concept or proposed fix

We aim to acknowledge reports within **2 business days** and ship a fix or
mitigation guidance within **14 days** for high/critical severity issues.

## Scope

This repo is a **reference starter** for integrating Stripe webhooks with the
[QubitOn API](https://www.qubiton.com). It is not a managed service and does
not handle production secrets, customer data, or payment processing on its
own — it runs on your infrastructure with your keys.

In scope:

- Vulnerabilities in the code under `src/` or `tests/`
- Misuse / footgun patterns that could lead to credential leakage or
  unverified webhook acceptance
- Issues in the Dockerfile, CI workflows, or dependency pinning that could
  expose users to supply-chain risk

Out of scope:

- Vulnerabilities in upstream dependencies (`stripe`, `express`,
  `@qubiton/sdk`) — please report those to the respective project
- Issues caused by misconfiguration on the operator's side (wrong env vars,
  incorrect proxy settings, etc.) — open a regular GitHub issue
- Reports from automated scanners without a clear exploitation path

## Handling secrets

This starter expects three secrets via environment variables:

- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook endpoint signing secret
- `QUBITON_API_KEY` — QubitOn API key

If you accidentally commit any of these to a public branch, **rotate them
immediately** at:

- Stripe: <https://dashboard.stripe.com/apikeys>
- QubitOn: <https://www.qubiton.com/dashboard/api-keys>

A leaked Stripe webhook signing secret lets an attacker forge dispute events
into your endpoint — rotate first, investigate logs after.
