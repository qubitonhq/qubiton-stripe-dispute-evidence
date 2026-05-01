# Changelog

All notable changes to this project will be documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Docker image** published to `ghcr.io/qubitonhq/qubiton-stripe-dispute-evidence`
  on every push to `main` and on `v*` tag pushes. Multi-arch
  (`linux/amd64` + `linux/arm64`), public, with build-provenance attestation
  and SBOM. Tags: `latest`, `main`, `main-<sha>`, and `vX.Y.Z`.
- README quickstart now leads with `docker run ghcr.io/qubitonhq/...:latest`
  for users who want to skip the clone-and-install path.

### Changed
- Bumped `@qubiton/sdk` to `^1.1.1` (was `^1.1.0`). Picks up the build-tooling
  refresh from qubitonhq/qubiton-node v1.1.1 — TypeScript 6, vitest 4, native
  `tsc` for type emission. No runtime API changes.
- `validateAddress` is now skipped when `billing_details.address.country` is
  missing (was firing with `country: ''` and getting silently 400'd).
- `PORT` and `SHUTDOWN_TIMEOUT_MS` env vars are now validated at boot — bad
  input throws instead of silently becoming `NaN`.
- `IP city` markdown line no longer renders a trailing comma when `region` is
  missing.
- Graceful shutdown now awaits the HTTP server's `close()` callback alongside
  in-flight evidence builds.
- CI / CodeQL workflows bumped to `actions/checkout@v6`,
  `actions/setup-node@v6`, and `github/codeql-action@v4` for parity with the
  qubiton-node SDK repo.
- `tests/` directory is now included in `tsc --noEmit` typecheck so test-side
  type drift is caught in CI.

### Added
- `package.json` `author` field.

### Documented
- `SHUTDOWN_TIMEOUT_MS` added to `.env.example`.
- Idempotency-key versioning convention (`:v1` → `:v2` for re-submits) called
  out in `buildEvidencePacket.ts`.

## [0.1.0] — 2026-05-01

Initial release. Reference implementation for the article
[*The Stripe dispute that eats every merchant's weekend*](https://www.qubiton.com/blog/stripe-dispute-evidence-packet).

### Added
- Express webhook server for `charge.dispute.created` with signature
  verification and immediate ACK.
- `buildEvidencePacket` orchestrator that fans out four parallel QubitOn
  enrichment calls (address, IP, phone, email) and submits the result via
  `stripe.disputes.update` with an idempotency key.
- Stripe Connect support — `stripeAccount` threaded through both
  `charges.retrieve` and `disputes.update`.
- Graceful SIGTERM/SIGINT shutdown that drains in-flight evidence builds.
- Multi-stage Dockerfile (non-root, healthcheck, alpine runtime).
- 13 unit + integration tests with mocked Stripe and QubitOn clients.
- GitHub Actions CI matrix (Node 20 + 22).
- Production-readiness checklist + troubleshooting guide in README.
