# Contributing

Thanks for the interest. This repo is a starter / reference implementation —
small in scope on purpose.

## Bug reports & feature requests

Open a GitHub issue with the matching template. For security issues, follow
[`SECURITY.md`](./SECURITY.md) instead — don't open a public issue.

## Pull requests

Before opening a PR:

1. **Fork and branch.** Branch names like `fix/stripe-connect-edge-case` or
   `feat/dispute-closed-handler`.
2. **Run CI locally.**
   ```bash
   npm install
   npm run ci   # lint + typecheck + test + build
   ```
   All four must pass — `--max-warnings 0` on lint and `tsc -p tsconfig.typecheck.json`
   on typecheck (covers tests too).
3. **Add or update tests.** Pure-logic changes go in `tests/composeEvidence.test.ts`
   or `tests/renderMarkdown` (lives in the same file). Webhook-layer changes
   go in `tests/app.test.ts`. Stripe-API or QubitOn-API integration changes
   go in `tests/buildEvidencePacket.test.ts` (uses mocked clients).
4. **Update CHANGELOG.md** under `[Unreleased]` if your change is user-facing.
5. **Match the existing style.** ESLint v9 flat config + typescript-eslint
   strict settings. No `any` without an explicit reason.

## Scope

This is a **reference starter**, not a managed service. PRs that fit:

- Fixes for bugs in the starter code
- New evidence fields supported by Stripe (`shipping_documentation` wiring,
  Visa CE 3.0 prior-transaction matching, etc.)
- Production-readiness improvements (retry queues, structured logging hooks,
  better Stripe Connect coverage, dispute-closure tracking)
- Documentation / README clarity
- CI / Docker / Dependabot tweaks

PRs that are out of scope:

- Forking to support non-Stripe webhook providers
- Adding QubitOn endpoints unrelated to dispute evidence
- Building a dispute-management dashboard / UI on top
- Hosting / SaaS-ifying this code

If you're not sure, open an issue first to discuss.

## Local quickstart

```bash
git clone https://github.com/qubitonhq/qubiton-stripe-dispute-evidence.git
cd qubiton-stripe-dispute-evidence
npm install
cp .env.example .env
# fill in test-mode Stripe + QubitOn keys
npm run dev

# in another terminal
stripe listen --forward-to localhost:3000/webhooks/stripe
stripe trigger charge.dispute.created
```

## Releasing

This repo is a reference starter — it is **not published** to npm or any
other registry. There is no automated publish workflow. Cloning a tag (or
the default branch) is how users consume it.

For maintainers who want to mark a notable starter snapshot:

```bash
npm version patch  # or minor / major — bumps package.json + creates a git tag
git push --follow-tags
```

Optionally, then create a [GitHub Release](https://github.com/qubitonhq/qubiton-stripe-dispute-evidence/releases/new)
from that tag with release notes pulled from `CHANGELOG.md`. Pushing the tag
on its own does not trigger any CI workflow — `ci.yml` runs on `push`/`pull_request`
to `main`, not on tag push.
