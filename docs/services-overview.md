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
| Product Service | 5001 | `product-service-db` | Extracted, verified. Admin routes (create/delete/toggle-featured/list-all) live as of the User/Auth Service retrofit. Also exposes `POST /api/products/batch` (public) for Cart Service's product-detail lookups. |
| User/Auth Service | 5002 | `user-service-db` | Extracted, verified. Issues stateless JWTs (`{ userId, role }` in both access and refresh tokens); `auth.middleware.js` duplicated into Product Service, Cart Service, and Coupon Service. |
| Cart Service | 5003 | Redis only, no MongoDB — key prefix `cart:*` on the same shared Redis instance as Product/User Service (see decision_log.md for the shared-instance limitation) | Extracted, verified. Rewritten (not copied) as a Redis Hash (`cart:{userId}`, field=productId, value=quantity); calls Product Service's batch endpoint to resolve full product details, with a deliberate `503` if Product Service is unreachable. |
| Coupon Service | 5004 | `coupon-service-db` | Extracted, verified. `getCoupon`/`validateCoupon` copied unchanged. New `PATCH /api/coupons/deactivate` (for Order Service to call once extracted) is gated by a shared-secret header (`X-Internal-Service-Key` / `INTERNAL_SERVICE_KEY`) rather than left public, since it's a write, not a read — see decision_log.md for the read/write rationale and the Enhanced-Gateway forward reference. |
| Order Service | — | — | Not yet extracted. |
