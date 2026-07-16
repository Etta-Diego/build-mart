# Services Overview (Stage 2 — Baseline Microservices)

Single place tracking each service's port, database, and extraction
status as they're pulled out of the monolith. Update this table when a
service is created, retrofitted, or its status otherwise changes. Full
rationale for each entry belongs in `docs/decision_log.md` — this file
is just the at-a-glance index.

For reference: the Stage 1 monolith (`backend/`) runs on port `5000`
against the `buildmart` database on the same Atlas cluster these
services also use.

| Service | Port | Database | Status |
|---|---|---|---|
| Product Service | 5001 | `product-service-db` | Extracted, verified. Admin routes (create/delete/toggle-featured/list-all) live as of the User/Auth Service retrofit. |
| User/Auth Service | 5002 | `user-service-db` | Extracted, verified. Issues stateless JWTs (`{ userId, role }` in both access and refresh tokens); `auth.middleware.js` duplicated into Product Service. |
| Cart Service | — | — | Not yet extracted. |
| Order Service | — | — | Not yet extracted. |
| Coupon Service | — | — | Not yet extracted. |
