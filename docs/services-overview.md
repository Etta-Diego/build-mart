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
| Coupon Service | 5004 | `coupon-service-db` | Extracted, verified. `getCoupon`/`validateCoupon` copied unchanged. `PATCH /api/coupons/deactivate` (shared-secret, called by Order Service) and `POST /api/coupons` (token-forwarded, reward-coupon creation, called by Order Service) — see decision_log.md for the read/write auth rationale and the Enhanced-Gateway forward reference. |
| Order Service | 5005 | `order-service-db` | Extracted, verified — fifth and final Baseline service. Orchestrates Cart Service (cart-clear) and Coupon Service (validate/create/deactivate) during checkout; does **not** call Product Service for pricing (client-submitted price trusted, exactly as the monolith did — a documented limitation, not an oversight) but does call Product Service's batch endpoint to resolve product details on order reads (`.populate()` no longer works across services). `createCheckoutSession` is fail-fast on any dependency outage (nothing irreversible has happened yet); `checkoutSuccess` is best-effort on coupon/cart calls (Stripe payment already confirmed, so the Order must never be lost) — see decision_log.md for the full fail-fast-vs-best-effort principle. |

All five Baseline Microservices are now extracted and verified. Next: the deferred optimization pass (indexes, pagination, compression, `Promise.all`) across all five services plus the monolith comparison, per the audit already logged in `decision_log.md`.
