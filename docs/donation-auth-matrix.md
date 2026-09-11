# Donation Auth Matrix (C02-T6)

> Source: `docs/spec-c02-donation-campaign-seam.md` (Implementation Decision: "Auth matrix documented and enforced").
> Enforced by: `tests/donation-auth-matrix.test.js` (HTTP adapter smoke tests, 20 cases).
> Code: `src/routes/donations.js`, `src/controllers/donationController.js`.

Legend: JWT = `Authorization: Bearer <JWT>` via `authenticateToken` (anon without token → 401,
invalid/expired → 403). Webhook secret = `x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>`.

| Endpoint | Anonymous | Owner (donor) | Non-owner user | Admin |
|---|---|---|---|---|
| `POST /api/donations` (create) | 401 | 201 (own donation, starts `pending`) | 201 (own donation) | 201 |
| `POST /api/donations/admin` (admin create) | 401 | 403 | 403 | 201 (`pending` or `completed`; completed recalcs totals) |
| `GET /api/donations/campaign/:campaignId` (public proof) | 200 (completed only) | 200 | 200 | 200 |
| `GET /api/donations/my-donations` | 401 | 200 (own rows) | 200 (own rows) | 200 (own rows) |
| `GET /api/donations/transaction/:id` | 401 | 200 | 403 | 200 |
| `GET /api/donations` (admin list) | 401 | 403 | 403 | 200 |
| `PATCH /api/donations/:id/status` | 401 | 403 (owner cannot self-approve) | 403 | 200 (via module `setStatus` + atomic recalc) |
| `DELETE /api/donations/:id` | 401 | 403 | 403 | 200 (via module `remove` + recalc) |
| `PATCH /api/donations/:donationId/proof` | 401 | 200 (replaces file, old media removed best-effort) | 403 | 403 (strict ownership — admin uploads via admin-create instead) |
| `PUT /api/donations/payment-status` (webhook) | 401 without secret (no JWT accepted here) | n/a (secret, not identity) | n/a | n/a — gateway flow; admin uses `PATCH /:id/status` |

Webhook detail (`PUT /payment-status`): header `x-webhook-secret` compared timing-safe
against `PAYMENT_WEBHOOK_SECRET`. Missing/wrong secret → 401 with no state change;
server secret unset/empty → 503 fail-closed (never an open writer); unknown
`transactionId` → 404; invalid `status` → 400; valid → 200 via the module seam
(`setStatus`, atomic recalc from C02-T1). Auth is checked before body validation.

## Decision record (Further Notes for C02-T6)

**Chosen: shared-secret verification, endpoint kept.** The alternative (delete the
webhook, route gateway callbacks through an authenticated worker) was rejected for
this iteration because user story 32 requires gateway confirmation without admin
action, and no authenticated-worker infrastructure exists yet (out of scope per the
spec). The secret lives in `PAYMENT_WEBHOOK_SECRET` (Cloudflare worker secret /
`.dev.vars` locally); rotation = update the secret on both sides. A signature scheme
(HMAC per-payload) is the natural follow-up once a real gateway contract exists.

**Also closed in this ticket:** `GET /api/donations` had JWT auth but no role check,
so any authenticated user could list all donations — now admin-only (403 otherwise),
matching `PATCH /:id/status` and `DELETE /:id`.

**Follow-up ADR proposed:** `docs/adr/0002-donation-campaign-transactional-seam.md`
(deep Donation module as the sole writer of `currentAmount`/`donorCount`).

**Glossary candidates for `/domain-modeling`:** `Donation`, `Donor`,
`ProofOfTransfer`, `CampaignStats` (`currentAmount`/`donorCount` as derived values).
Not added to `CONTEXT.md` here — left for the domain-modeling pass.

## Test coverage scope

The smoke tests pin every 401/403 gate in the table plus full 200 round-trips for
the webhook, admin status update, and owner/admin transaction lookup (all against
the in-memory fake DB, delegating to the C02-T1 module seam). Not smoke-tested here:
200-paths that require the real drizzle query builder (admin list 200, my-donations
200, public campaign list 200, proof upload owner 200) and admin `DELETE` 200 /
`POST /admin` 201 — those go through unchanged drizzle paths and are documented
from code; the drizzle prod-path harness precedent covers that layer.
