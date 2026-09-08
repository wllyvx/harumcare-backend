# Spec: C02 — Close the Donation → Campaign Seam

> Source: conversation context C02 + codebase exploration (donation controller, campaign controller, schema, routes)
> Glossary: `CONTEXT.md` (Campaign; Donation/Donor/ProofOfTransfer not yet in glossary — gap noted for `/domain-modeling`)
> ADR: `docs/adr/0001-unify-publishable-content-module.md` (pattern precedent: deep module + thin adapters + injected `db`/`media`; no ADR yet for donations — this spec proposes one)

## Problem Statement

Sebagai donatur HarumCare, saya berdonasi ke sebuah Campaign dan mengunggah bukti transfer, lalu status donasi saya diverifikasi admin atau webhook pembayaran. Saya mengharapkan nominal Campaign (`currentAmount`), jumlah donatur (`donorCount`), dan progress selalu akurat setelah setiap perubahan status.

Saat ini transisi status donasi bocor menyeberang seam ke statistik Campaign: guard "completed ↔ non-completed" di-copy-paste di empat call site, tulis donasi → hitung ulang → tulis Campaign tidak atomik sehingga kegagalan parsial membuat statistik meleset, penghapusan Campaign dengan donasi terkait tidak transaksional sehingga menyisakan orphan rows, dua endpoint create duplikat 80% validasi, dua nama status (`paymentStatus` vs `status`) dan dua route create (`POST /donations` vs `POST /campaigns/:id/donate`) membingungkan, serta ada field yang dipakai tapi tidak ada di schema sehingga request meledak saat runtime. Sebagai admin, saya juga menghadapi matriks auth yang membingungkan antara webhook publik tanpa auth dan endpoint admin.

## Solution

Satu deep Donation module memiliki seluruh transisi status dan perhitungan ulang statistik Campaign. Caller (webhook, admin update, admin create, admin delete, proof upload) tidak lagi mengimplementasikan guard atau menulis statistik Campaign secara langsung — mereka memanggil `create` / `complete` / `fail` / `updateProof` / `remove`, dan module yang menjamin transisi + hitung ulang terjadi atomik. Campaign module menjadi read-only atas `currentAmount`/`donorCount` (tidak pernah write). Satu route create kanonis (`POST /donations` dengan `campaignId` di body) menggantikan duplikat route; penamaan status disatukan; schema diperbaiki; ID transaksi collision-proof; pagination admin konsisten antara `total` dan `items`.

## User Stories

1. As a donor, I want to create a donation to a Campaign with amount, payment method, and message, so that I can contribute to a cause I care about
2. As a donor, I want my donation to start in `pending` status awaiting verification, so that I know it is being processed
3. As a donor, I want donations below the minimum nominal to be rejected with a clear error, so that I know the valid threshold
4. As a donor, I want donations to ended Campaigns to be rejected, so that I do not pay into a closed cause
5. As a donor, I want donations to nonexistent Campaigns to return not-found, so that I know I targeted the wrong Campaign
6. As a donor, I want to donate anonymously as "Hamba Allah", so that my identity stays private
7. As a donor, I want to donate with my name (defaulting to my account name), so that my contribution is attributed
8. As a donor, I want to upload proof of transfer for my own donation, so that admin can verify my payment
9. As a donor, I want uploading a new proof to replace the old file without orphaning storage, so that storage does not leak
10. As a donor, I want to update only my own donation's proof (non-owners get forbidden), so that my donation cannot be tampered with
11. As a donor, I want to list my own donations paginated, so that I can track my giving history
12. As a donor, I want my donation list to show the linked Campaign title and image, so that I recognize each cause
13. As a public visitor, I want to list completed donations for a Campaign paginated, so that I can see social proof before donating
14. As a public visitor, I want Campaign progress (`currentAmount` / target, `donorCount`) to reflect only completed donations, so that I trust the numbers
15. As a donor, I want my donation to appear in Campaign totals only after it becomes completed, so that pending donations do not inflate progress
16. As a donor, I want my completed donation that later fails to subtract from Campaign totals, so that numbers stay truthful
17. As a donor, I want a failed donation that later completes to add back to Campaign totals, so that recovery is reflected
18. As an admin, I want to list all donations with pagination and status/payment-method filters, so that I can moderate the queue
19. As an admin, I want the admin list `total` to match the filtered `items` (valid-Campaign filter applied consistently), so that pagination is not broken
20. As an admin, I want to approve a pending donation to completed, so that the donor's contribution counts
21. As an admin, I want to reject a donation to failed, so that invalid payments do not count
22. As an admin, I want status transitions to set `completedAt` only on completion, so that timestamps are meaningful
23. As an admin, I want invalid status values to be rejected, so that the state machine cannot be corrupted
24. As an admin, I want non-admins to be forbidden from status changes, so that donors cannot self-approve
25. As an admin, I want to create a donation on behalf of a donor (offline/manual payment), so that cash/transfer donations are recorded
26. As an admin, I want admin-created completed donations to update Campaign totals immediately, so that manual entries count
27. As an admin, I want admin-create validation to match user-create validation (min nominal, Campaign exists, Campaign active), so that rules are consistent
28. As an admin, I want to delete a donation and have Campaign totals recalculated when it was completed, so that numbers stay correct
29. As an admin, I want deleting a donation to clean up its proof file best-effort, so that storage is reclaimed
30. As an admin, I want to delete a Campaign with donations atomically (donations + Campaign removed together, media cleaned up), so that no orphan rows remain
31. As an admin, I want a warning when deleting a Campaign that has donations, so that I am aware of consequences
32. As a payment gateway, I want to report status by transaction ID via webhook, so that payments confirm without admin action
33. As a platform owner, I want the webhook and admin status endpoints to have a clear, documented auth matrix, so that the public endpoint cannot be abused for privilege escalation
34. As a donor, I want to look up my donation by transaction ID (owner or admin only), so that I can check payment state
35. As a developer, I want one canonical create route (no `campaignId` body-vs-URL mismatch), so that clients cannot send conflicting targets
36. As a developer, I want transaction IDs to be collision-proof (not timestamp+small-random), so that concurrent creates never collide on the unique constraint
37. As a developer, I want every field written by the module to exist in the schema (no phantom `uniqueCode`), so that requests never crash on unknown columns
38. As a developer, I want one seam for the completed-transition guard, so that a bug fix applies to all four call sites at once
39. As a developer, I want failed batches to roll back (no partial donation-without-stats or stats-without-donation), so that retries are safe

## Implementation Decisions

- **Single deep seam**: a Donation module factory with injected dependencies (`db`, `media`) is the sole seam. It owns the full transition state machine: `create(dto, user)`, `complete(id)`, `fail(id)`, `updateProof(id, proofUrl, user)`, `remove(id)`, and `recalcStats(campaignId)`. No Hono context leaks into the module (same DI discipline as ADR-0001: `db`/`media` injected, never `c`/`c.env`). Controllers/routes become thin adapters mapping HTTP ↔ module.
- **Guard lives inside, once**: the completed-transition guard ("changed to/from completed → recalc") is implemented exactly once inside `complete`/`fail`/`remove`. The four current call sites (webhook update, admin status update, admin delete, admin create) are reduced to single method calls; copy-pasted guard expressions are deleted, not moved.
- **Atomic recalc**: status transition + `sum(amount)` + `count(id)` over completed donations + Campaign write happen in one atomic batch. Partial failure rolls back; no donation-without-stats or stats-without-donation states are observable. Batch failure surfaces as 500 with no side effects, safe to retry.
- **Campaign is read-only for stats**: the Campaign side never writes `currentAmount`/`donorCount` directly (the existing strip-these-fields-on-update behavior becomes a hard rule at the module boundary, not just request sanitization). Only the Donation module's `recalcStats` writes those two columns. All other Campaign fields remain owned by the Campaign flow.
- **Campaign delete compensation**: Campaign removal (Campaign row + related donation rows + proof/image media cleanup) is atomic or compensated — either one batch covering all deletes, or DB deletes batched with media removal best-effort-after-commit plus a logged warning. The current sequential loop with interleaved media deletes is removed. The "campaign has donations" warning is preserved as structured return data, not just a console log.
- **Single canonical create**: one create route with `campaignId` in the body is canonical. The duplicate campaign-scoped donate route is removed or reduced to a thin adapter that forwards to the same module method (URL `:id` mapped to body `campaignId`, conflict → 400). No divergent validation paths.
- **Unified create validation**: user-create and admin-create share one validation path (required fields, min nominal Rp 1.000, Campaign exists, Campaign not ended). The only admin extras are actor attribution (`userId` = acting admin) and allowed initial `paymentStatus`. 80% duplicated validation collapses into the module.
- **Status vocabulary**: one status field name and one value set (`pending` | `completed` | `failed`) across webhook, admin, and responses. `completedAt` is set exactly on entry to `completed` (idempotent — re-completing does not move the timestamp) and never on other transitions.
- **Auth matrix documented and enforced**: webhook endpoint gets an explicit decision (shared-secret/signature verification or removal in favor of admin-only flow — decision recorded in Further Notes of the implementing ticket); admin endpoints require admin role; proof upload requires ownership; transaction lookup requires owner-or-admin. No public unauthenticated writer remains by accident.
- **Transaction ID generation**: collision-proof IDs (UUID-based) replace timestamp-plus-small-random. Unique-constraint collisions become practically impossible; on the residual collision the module retries once then returns a 409, never a 500.
- **Schema fix**: either the missing `uniqueCode` column is added via migration (with backfill default null) or all usages are removed — no phantom-column writes. Decision defaults to removal unless a product need for unique codes is demonstrated, since nothing reads the column today.
- **Admin list count consistency**: `total` is computed with the identical filter as `items` (status, payment method, valid-Campaign join). Pagination meta (`totalPages = ceil(total/limit)`, `currentPage`) is consistent with the returned page.
- **Dead code removal**: the unused join-mapping helper is deleted; join shaping is owned by the module's row mapper with one shape per consumer (public-by-campaign, my-donations, admin list, transaction lookup).
- **Glossary adherence**: use `Campaign` per `CONTEXT.md` (avoid program/project). `Donation`, `Donor`, `ProofOfTransfer` are not yet in the glossary — this spec uses them in their plain-language sense and flags them as candidates for `/domain-modeling`.
- **No ADR conflict**: ADR-0001 covers PublishableContent only; this spec extends the same deep-module pattern to donations and proposes a follow-up ADR for the donation→campaign transactional seam upon implementation.

## Testing Decisions

- **What makes a good test**: test external behavior at the highest seam (the Donation module interface + thin HTTP adapter status mapping), not implementation details. Assert observable outcomes — donation rows, Campaign `currentAmount`/`donorCount`, HTTP codes, error messages — never internal SQL strings, guard expressions, or batch composition. Prefer a real D1 fake over mocks; mock/fake only `media`.
- **Which modules will be tested**: the Donation module (all transition methods + `recalcStats`) is the primary surface. Route adapters get smoke tests for auth mapping (owner vs admin vs anon, webhook matrix) and envelope shapes, not business logic. The Campaign side gets a contract test: no path outside the Donation module writes `currentAmount`/`donorCount`.
- **Prior art**: the repo has no `npm test` harness yet; the C01 spec introduces `vitest` + in-memory D1 fake + Map-backed `media` fake as precedent. This spec reuses that harness (no new framework); the only new fake is a failing-batch injector to prove rollback.
- **Priority test cases (must pass before merge)**:
  - `create` (pending) → Campaign totals unchanged; `complete` → `currentAmount` +amount and `donorCount` +1; `fail` after complete → totals subtract back
  - Re-completing an already-completed donation does not double-count and does not move `completedAt`
  - `remove` of a completed donation recalcs; `remove` of a pending donation leaves totals untouched
  - Batch failure mid-transition rolls back: neither donation row nor Campaign stats change
  - Admin-create with `paymentStatus: completed` updates totals; with `pending` does not
  - Proof update by owner replaces file and removes old media; by non-owner → 403; media failure does not fail the DB update
  - Campaign delete removes Campaign + donations atomically; media failure does not orphan DB rows
  - Admin list `total` equals filtered item count across status/payment-method filters
  - Duplicate-title-style collision test for transaction IDs: concurrent creates never violate uniqueness
  - Auth matrix: webhook/admin/owner/anon cases return the documented codes
- **Seams**: one seam (the Donation module) is sufficient. Higher seams (full HTTP through Hono) only for auth smoke tests; lower seams (recalc helper, validators) are not tested in isolation. `media` is the only injected fake besides the batch-failure injector.

## Out of Scope

- Real payment-gateway integration (signature schemes, retries, reconciliation jobs) beyond documenting/securing the existing webhook seam
- C01 publishable-content unification, C03 auth deepening, C04 standalone media module, C05 request-boundary validation — each a separate candidate; shared `media.remove` best-effort helper is reused, not redesigned here
- Frontend contract changes beyond the single-canonical-create route decision (legacy `_id` aliasing preserved as-is)
- Rate limiting, caching, notification fan-out on donation events, analytics dashboards
- Schema migration to any new Campaign/donation modeling (e.g. ledger/event-sourced donations) — recalc-over-completed-rows stays the mechanism in this iteration

## Further Notes

- **Seam proposal awaiting your confirmation**: one seam — Donation module factory with injected (`db`, `media`) exposing `create`/`complete`/`fail`/`updateProof`/`remove`/`recalcStats`; Campaign side read-only for stats; existing `media.remove` best-effort seam reused; atomicity via `db.batch`. If you prefer two seams (separate StatsUpdater), say so and this spec will be amended before implementation.
- **Webhook auth is the riskiest open decision**: the current public `PUT /payment-status` lets anyone set any status by transaction ID. The implementing ticket must either add shared-secret/signature verification or delete the endpoint and route gateway callbacks through an authenticated worker. Do not ship the refactor with the endpoint unchanged.
- **Glossary gap**: `Donation`, `Donor`, `ProofOfTransfer`, `CampaignStats` (`currentAmount`/`donorCount` as derived values) are proposed terms for `/domain-modeling`.
- **Benefits**: locality (transition bugs live in one module), leverage (one seam fixes four call sites), orphan rows eliminated by batching, naming/routing consistent for clients.
- **Suggested steps (reference)**: extract Donation module with transition methods → move guard inside → replace all stats-write calls with `complete`/`fail`/`remove` → batch writes → fix schema phantom column → collapse duplicate create route → lock auth matrix.
