# ADR-0002 (Proposed): Donation → Campaign Transactional Seam

Status: **Proposed** (follow-up proposed by C02-T6 per `docs/spec-c02-donation-campaign-seam.md`).

## Context

Campaign progress (`currentAmount`, `donorCount`) is derived from completed donations,
but historically written from four scattered call sites (webhook update, admin status
update, admin delete, admin create) with a copy-pasted completed-transition guard and
non-atomic donation-write → recalc → Campaign-write sequences. C02-T1 introduced the
deep Donation module (`create`/`complete`/`fail`/`setStatus`/`remove`/`recalcStats`,
plus `findByTransactionId` from C02-T6) as the single seam; C02-T6 locked the webhook
with a shared secret and documented the auth matrix (`docs/donation-auth-matrix.md`).

## Decision (proposed)

- The Donation module is the **sole writer** of `campaigns.currentAmount` /
  `campaigns.donorCount`. The Campaign side is read-only for those two columns
  (existing strip-on-update behavior becomes a hard module-boundary rule).
- Every status transition commits donation-write + stats-rewrite atomically
  (`db.batch` on drizzle; snapshot-rollback on the memory path), so no
  donation-without-stats or stats-without-donation state is observable.
- Campaign deletion removes Campaign + related donations atomically (or DB-batched
  with media cleanup best-effort-after-commit plus logged warning); the
  "campaign has donations" warning is structured return data, not a console log.

## Considered options

- (A) Separate StatsUpdater second seam — rejected for now: one seam already covers
  all four call sites, and a second seam would split the atomicity guarantee across
  two owners. Revisit if Campaign stats grow non-donation inputs.
- (B) Keep per-caller guards with a shared helper — rejected: the guard already lives
  exactly once inside the module; a helper would re-invite call-site drift.

## Consequences

Transition bugs live in one module; the webhook/admin adapters stay thin; retries
after batch failure are safe (500 with no side effects). Glossary candidates
(`Donation`, `Donor`, `ProofOfTransfer`, `CampaignStats`) go through
`/domain-modeling` before entering `CONTEXT.md`.
