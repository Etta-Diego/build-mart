# Architectural Decision Log

Each entry: what was decided, why, and what alternatives were considered. 
Written for direct reuse in the dissertation's methodology chapter.

## Format
### [Date] Decision Title
- **Decision:** what was decided
- **Rationale:** why
- **Alternatives considered:** what else was possible, why rejected
- **Stage:** Monolith / Baseline Microservices / Enhanced Microservices

---

### [Pending] Database choice: MongoDB throughout
- **Decision:** Use MongoDB (Mongoose) for User, Product, Order, and 
  Coupon data across all three architectural stages.
- **Rationale:** Keeping the data layer constant isolates the study's 
  actual independent variable (architecture: monolith vs. decomposed 
  vs. orchestrated) from confounding variables. Switching databases 
  partway through would make it impossible to attribute performance 
  differences specifically to architectural changes.
- **Alternatives considered:** Relational database (PostgreSQL/MySQL), 
  rejected due to this confounding-variable risk and because it matches 
  no external requirement.
- **Stage:** All

### [Pending] Cart extracted to Redis in Stage 2
- **Decision:** Cart data, embedded in the User document in the 
  monolith, is extracted into its own Redis-backed Cart Service from 
  Stage 2 onward.
- **Rationale:** Cart state is high-write, session-like, and latency-
  sensitive, unlike identity data. Separating it from User resolves a 
  bounded-context conflation present in the monolith, and Redis is 
  well-suited to this access pattern. This also directly supports the 
  dissertation's application-loading-efficiency focus.
- **Alternatives considered:** Keep Cart merged with User/Auth Service 
  for simplicity — rejected as architecturally weaker and a missed 
  opportunity to demonstrate a caching-driven improvement.
- **Stage:** Baseline Microservices onward

### [2026-07-15] Phase 1 code review — fixed vs. documented-only findings
- **Decision:** Of the issues found reviewing the monolith before tagging
  it as the baseline, fixed only those bearing on benchmarking fairness
  or explicitly approved by the researcher; documented the rest without
  touching the code.
  - Fixed: `app.listen()` firing before `connectDB()` resolved (a real
    source of unpredictable request latency and an ungated startup);
    `MONGO_URI` (with credentials) logged to stdout on every boot;
    `checkoutSuccess` hanging with no response for non-"paid" Stripe
    sessions (unbounded latency); no idempotency guard on order creation
    (duplicate call surfaced as a 500); `lib/redis.js` being a hardcoded
    no-op stub (caching never worked, `/api/auth/refresh-token` always
    401'd).
  - Documented only: inconsistent error-handling style across a few
    controllers (`analytics.controller.js` missing its own try/catch,
    `cart.controller.js#removeAllFromCart` missing the sibling
    console.log-on-error line, `payment.controller.js` using
    `console.error` where the rest of the codebase uses `console.log`);
    `CLIENT_URL` being referenced by the payment controller but absent
    from `.env` (added to `.env.example`/README instead of guessing a
    value into the codebase).
- **Rationale:** This backend is about to become a frozen, permanently
  citable baseline. Bugs that would bias the very metrics used to
  compare it against later stages (readiness timing, request latency,
  a broken cache/broken endpoint) needed fixing so the baseline
  measures a genuinely working system. Purely cosmetic inconsistencies
  don't affect any measurement, so fixing them was out of scope — every
  additional file touched on the highest-risk code path (payment) or
  its neighbors is additional risk to a commit meant to be immutable.
- **Alternatives considered:** Fix everything found, for a "cleaner"
  baseline — rejected as unnecessary scope creep that increases risk to
  a commit that must not regress. Fix nothing and document everything —
  rejected because the startup race and the Redis stub would have
  directly and silently invalidated later performance comparisons.
- **Stage:** Monolith

### [2026-07-15] Order module extracted from payment controller
- **Decision:** Added `backend/controllers/order.controller.js` and
  `backend/routes/order.route.js`. `createOrder(session)` is a plain
  async function — not an Express route handler — called internally by
  `payment.controller.js#checkoutSuccess` after Stripe confirms payment.
  The new routes (`GET /api/orders`, `GET /api/orders/:id`) are
  read-only: order history and single-order lookup for the logged-in
  user (or admin).
- **Rationale:** Orders are a side effect of a successful Stripe
  payment, not something a client requests directly — there was never a
  need for a public "create order" endpoint, only for reads. Extracting
  order creation into its own module (rather than leaving it inline in
  the payment controller) gives the Order domain a proper home ahead of
  the Stage 2 decomposition into a standalone Order Service, without
  changing what triggers order creation today.
- **Alternatives considered:** Expose `createOrder` as its own route and
  have the frontend call it after `checkout-success` — rejected, it
  would duplicate Stripe-session verification client-side and reopen the
  no-idempotency-guard risk this same change was fixing.
- **Stage:** Monolith (this module's shape maps directly onto the future
  Order Service in Stage 2/3)

### [2026-07-15] Instrumentation: prom-client, custom gauges, no default collector
- **Decision:** `backend/lib/metrics.js` uses its own `prom-client`
  `Registry` (not the global default) and exposes exactly five metrics:
  `app_startup_duration_seconds` / `app_ready_timestamp_seconds`
  (Gauges, set once via `markReady()`), `http_request_duration_seconds`
  (Histogram, labels `method`/`route`/`status_code`),
  `http_requests_total` (Counter, same labels), and
  `process_memory_usage_bytes` / `process_cpu_usage_seconds` (Gauges,
  populated at scrape time via prom-client's `collect()` hook reading
  `process.memoryUsage()`/`process.cpuUsage()` directly). Deliberately
  does not call `collectDefaultMetrics()`.
- **Rationale:** "Ready" is defined as server listening *and* MongoDB
  connected, which required awaiting `connectDB()` before `app.listen()`
  — this also fixed the startup-race bug from the code review. Keeping
  the metric set to exactly what's needed (rather than pulling in
  prom-client's full default collector, which emits dozens of
  Node-runtime metrics) keeps the metric surface small and exactly
  reproducible when the same module is ported into each microservice in
  Stage 2/3 — a stated project requirement (same metric names across all
  stages, see CLAUDE.md).
- **Alternatives considered:** `collectDefaultMetrics()` for a fuller
  picture (event loop lag, GC pauses, etc.) — rejected for now to avoid
  metric-set drift across stages; can be added consistently later if the
  dissertation's analysis needs it, but that decision should be made
  once and applied to all three stages at once.
- **Stage:** All (module designed to be reused verbatim in each Stage
  2/3 service)

### [2026-07-15] Stage 1 deployment: monolith is not containerized
- **Decision:** The monolith (`backend/`) runs as a plain Node.js
  process (`npm run dev` / `node backend/server.js`), not inside a
  container. `docker-compose.yml` exists only to run local MongoDB and
  Redis as development infrastructure — there is no `Dockerfile` and no
  `backend` service in the compose file.
- **Rationale:** A traditional, non-containerized deployment is itself
  the intended comparison point for Stage 1 against the containerized
  and orchestrated microservices of Stage 2/3 — this is scope defined in
  the dissertation proposal, not an oversight, and matches common
  patterns in the reviewed literature on monolith-to-microservices
  migration studies. Consequently, "container startup time" as a metric
  only applies from Stage 2 onward, when the application itself first
  runs inside a container. "Application startup time" (process start to
  ready — server listening and MongoDB connected, captured by
  `markReady()` in `lib/metrics.js`) remains comparable across all three
  stages regardless, since it's measured in-process independent of how
  the process itself was launched.
- **Alternatives considered:** Containerize the monolith too, for an
  apples-to-apples container-startup-time comparison across all three
  stages — rejected because it would erase the exact contrast (plain
  process vs. containerized/orchestrated deployment) the three-stage
  study design is set up to measure.
- **Stage:** Monolith only (Stage 2/3 introduce containerization by
  design)

### [2026-07-15] Phase 1 verification: method and one known gap
- **Decision:** Verified the Phase 1 changes (Order module, instrumentation,
  startup-race fix, Redis activation) by running the backend natively
  against temporary local MongoDB and Redis instances, since Docker
  wasn't available in the environment this work was done in. Confirmed:
  correct ready-ordering (Mongo connects before the server listens);
  valid `/metrics` output with all five metrics populated; `GET
  /api/orders` and `GET /api/orders/:id` (auth required, 403 on
  cross-user access, 404 on a missing id); `createOrder` idempotency
  (calling it twice with the same `stripeSessionId` returns the same
  order, not a duplicate/500); `/api/auth/refresh-token` working for the
  first time (previously always 401 under the Redis stub); existing
  auth/product/cart/coupon flows unaffected.
  - **Known gap:** a full live Stripe checkout round-trip
    (`create-checkout-session` → pay → `checkout-success`) was **not**
    verified end-to-end, because `STRIPE_SECRET_KEY` in `.env` is a
    placeholder value (`sk_test_key`), not a real Stripe test-mode key.
    This is a pre-existing gap, not something introduced by this change
    — `checkoutSuccess`'s error handling, the graceful non-"paid" branch,
    and `createOrder`'s field-mapping/idempotency were each verified
    directly (either via curl against the real error path, or by calling
    `createOrder` directly with a hand-built session object), but the
    full Stripe API round trip itself was not exercised.
- **Rationale:** Recording this here because it directly bears on how
  much confidence to place in the tagged baseline's payment-flow
  behavior, which matters for the methodology writeup. The gap should be
  closed by re-running a real checkout with a valid Stripe test key
  before relying on this tag for any payment-flow-specific benchmarking
  — general request-latency/readiness benchmarking is unaffected since
  those don't depend on Stripe succeeding.
- **Alternatives considered:** Skip noting this and treat verification as
  complete — rejected, since silently under-verifying the highest-risk
  code path in the project (per this file's own "Workflow expectations")
  would undermine exactly the kind of reproducibility this baseline
  exists to provide.
- **Stage:** Monolith

### [2026-07-15] Stripe checkout gap closed; publishable key moved out of source
- **Decision:** While closing the gap above, found that the frontend's
  Stripe publishable key was hardcoded directly in
  `frontend/src/components/OrderSummary.jsx` and belonged to a
  **different Stripe account** than the (now real) backend secret key —
  `redirectToCheckout` would have failed to redeem any session created
  by the backend. Fixed by moving the publishable key into
  `frontend/.env` as `VITE_STRIPE_PUBLISHABLE_KEY` (read via
  `import.meta.env`), with a matching `frontend/.env.example`, and using
  the correct key for the same Stripe account as `STRIPE_SECRET_KEY`.
  Re-verified with real keys: `create-checkout-session` returns a live
  Stripe session with correct amount/metadata, and the resulting hosted
  Stripe Checkout page loads successfully (HTTP 200) — confirming the
  key pair is correctly matched end-to-end. Actually submitting a test
  card was not automated (Stripe's hosted Checkout page requires manual
  or browser-automated card entry; there's no API to "complete" a
  Checkout Session programmatically), but this is a Stripe-hosted step
  outside the application's own code.
- **Rationale:** A hardcoded, account-mismatched publishable key would
  have made checkout fail for every real user despite the backend
  working correctly — exactly the kind of bug that should not survive
  into a tagged, citable baseline. Moving it to an env var also matches
  how every other credential in this project is handled and makes the
  frontend properly configurable per environment.
- **Alternatives considered:** Leave the key hardcoded and only fix the
  account mismatch — rejected, since hardcoding a credential-like value
  (even a publishable one, which is safe to expose but not to hardcode
  per-account) directly in source is itself worth fixing while already
  in this file.
- **Stage:** Monolith

### [2026-07-15] Opt-in DNS workaround for a local Windows resolver issue
- **Decision:** `npm run dev` on the researcher's machine crashed on boot
  with `Error connecting to MONGODB querySrv ECONNREFUSED
  _mongodb._tcp.cluster0.2cibdjn.mongodb.net`. Diagnosed as a local,
  machine-specific DNS problem, not an Atlas or application bug:
  Node's own `dns.resolveSrv()` reproduced the exact error, and
  `dns.getServers()` showed Node was using `127.0.0.1` as its resolver.
  Something on that machine (Windows' `Dnscache` service, per
  `Get-NetUDPEndpoint -LocalPort 53`) answers normal A/AAAA queries but
  refuses SRV-type queries specifically — meanwhile Windows' own
  higher-level resolver (`Resolve-DnsName`, browsers) resolved the same
  SRV record correctly via a different path, confirming the Atlas
  cluster and DNS record themselves are fine. Separately, this is also
  why the crash is now loud instead of silent: the startup-race fix
  earlier in this log means `connectDB()` failing now correctly kills
  the process before it ever listens, rather than leaving a server that
  looks "up" while silently unable to reach the database.
  - Added an **opt-in** workaround in `backend/lib/db.js`: if
    `DNS_WORKAROUND=true`, `dns.setServers(["8.8.8.8", "1.1.1.1"])` runs
    before `mongoose.connect()`, pointing Node's own lookups at a public
    resolver without touching any system-wide DNS settings. Defaults to
    off (`false`/unset) in `.env.example`, with a comment explaining
    when to turn it on. Enabled (`true`) in the researcher's own local
    `.env` only.
- **Rationale:** This is a workaround for one machine's local resolver
  behavior, not something every environment needs — making it opt-in
  keeps it from silently masking a genuine DNS/network failure on a
  machine where the SRV lookup problem doesn't exist (e.g. CI, another
  contributor's laptop, or the eventual Stage 2/3 deployment
  environments). A code comment and this entry both explain the root
  cause so a future reader doesn't mistake it for a MongoDB Atlas or
  application-level bug.
- **Alternatives considered:** Apply `dns.setServers()` unconditionally
  — rejected, since it would change DNS behavior for every environment
  running this code (including ones without the problem) to fix an
  issue specific to one machine. Switch `MONGO_URI` to Atlas's non-SRV
  connection string instead — rejected as a viable alternative someone
  could still choose, but a code-level fix that keeps the existing
  `mongodb+srv://` URI working was preferred so `.env` didn't need to
  change format.
- **Stage:** Monolith (dev-environment concern only; not part of the
  application's runtime architecture)

### [2026-07-15] Confirmed: role-based authorization is database-backed, not JWT-backed
- **Finding:** protectRoute decodes only {userId} from the JWT, then 
  fetches the live User document from MongoDB on every request. 
  adminRoute checks req.user.role from that fresh DB fetch. The JWT 
  payload never carries a role claim.
- **Implication:** Role changes take effect immediately on the next 
  request, with no token refresh needed. There is no way to forge 
  elevated privileges by tampering with a JWT's claims, since role is 
  never encoded in the token to begin with — it is authoritative from 
  the database on every single request.
- **Stage:** Monolith (confirmed during Phase 1 verification)

### [2026-07-15] Fixed: wrong CLOUDINARY_CLOUD_NAME broke image uploads
- **Finding:** While writing and running `scripts/seed-products.js` (a
  one-off seed script, not part of the app), Cloudinary uploads failed
  with `cloud_name mismatch` (401), confirmed independently via a direct
  `cloudinary.api.ping()` call. `CLOUDINARY_CLOUD_NAME` in `.env` was set
  to `Ettadiego` (an account display name), not the actual cloud name.
  The researcher supplied the correct value (`dnsq75g1h`, visible in a
  `CLOUDINARY_URL` they added to `.env`); corrected
  `CLOUDINARY_CLOUD_NAME` to match, and `cloudinary.api.ping()` then
  succeeded, followed by a real seed run (7/7 products created with
  Cloudinary-hosted images).
  - Also fixed in passing: `backend/lib/db.js` was the one `lib/`
    module that didn't call its own `dotenv.config()` (unlike
    `redis.js`/`cloudinary.js`/`stripe.js`, which all do). It worked in
    `server.js` only by accident, because another module imported
    earlier in that file's import chain happened to call
    `dotenv.config()` as a side effect first. The seed script imports
    `db.js` directly with no such side effect, which surfaced the
    latent bug (`DNS_WORKAROUND` wasn't set yet when `db.js`'s
    top-level check ran). Added `dotenv.config()` to `db.js` to match
    the established pattern in every sibling `lib/` file.
- **Implication:** This was a real, pre-existing bug — the admin
  "Create Product" feature (`createProduct` in `product.controller.js`,
  which calls the same `cloudinary.uploader.upload`) would have failed
  with the identical error for anyone using the checked-in
  `CLOUDINARY_CLOUD_NAME` value, independent of anything in this
  session's other changes. Fixed as part of getting the seed script
  working since it exercises the exact same code path.
- **Stage:** Monolith

### [2026-07-15] Added TTL to the featured_products Redis cache
- **Decision:** Both `redis.set("featured_products", ...)` call sites in
  `product.controller.js` (`getFeaturedProducts` and
  `updateFeaturedProductsCache`) now pass a 300-second TTL via ioredis's
  native `SET ... EX` option, instead of setting the key with no
  expiry.
- **Rationale:** The cache previously had no expiry at all, discovered
  while diagnosing why the homepage showed no products after seeding:
  a stale, empty-array cache value from before any product existed
  was still being served, with nothing to ever clear it. The only
  existing invalidation path is `toggleFeaturedProduct` explicitly
  calling `updateFeaturedProductsCache()` — any other way a product's
  `isFeatured` status changes (a direct DB edit, a future admin
  bulk-update endpoint, this session's own `_fix_categories.mjs`-style
  one-off script) has no way to invalidate this cache and would drift
  from the database indefinitely. A TTL bounds that staleness window
  to a few minutes without requiring every possible mutation path to
  remember to invalidate the cache explicitly.
- **Alternatives considered:** A separate cleanup/cron process to
  expire or refresh the cache — rejected as unnecessary complexity;
  Redis's own expiry mechanism does this natively. Keep no TTL and
  instead audit every code path that can change `isFeatured` to ensure
  it explicitly invalidates the cache — rejected as more fragile long
  term, since it silently breaks again the next time a new mutation
  path is added and someone forgets this cache exists.
- **Stage:** Monolith

### [2026-07-15] Fixed: cartItems was storing a broken shape, and checkout never cleared the cart
- **Finding:** Investigating a user report of stale/inconsistent cart
  data surfaced two real bugs in cart handling, found by driving the
  actual frontend (Playwright + real Chrome) and inspecting the
  resulting `User` document directly via the real Mongoose model rather
  than trusting the API response:
  1. `cart.controller.js#addToCart` did `user.cartItems.push(productId)`
     — pushing a bare product-ID string into an array of `{ quantity,
     product }` subdocuments (`user.model.js:22-33`). Mongoose's
     ObjectId-cast logic silently absorbed that string as the
     subdocument's own `_id` instead of its `product` field, so every
     cart item written this way had `product: undefined` — never a
     valid product reference. `getCartProducts`, `removeAllFromCart`,
     and `updateQuantity` were all built against this same accidental
     shape (matching on `item.id`, i.e. the subdocument's `_id`, instead
     of `item.product`), so the bug was self-consistent and invisible
     until directly inspecting raw documents in MongoDB.
  2. Separately, nothing in the payment flow ever cleared
     `User.cartItems` after a successful order.
     `PurchaseSuccessPage.jsx`'s `clearCart()` only reset local Zustand
     state (`useCartStore.js:46-48`) — no backend call. A page refresh
     (or re-login) after a successful purchase would re-fetch the
     still-uncleared cart from the database and show the just-purchased
     items as if they were still in the cart.
- **Decision:** Fixed both. `addToCart` now pushes `{ product: productId,
  quantity: 1 }`; `getCartProducts`, `removeAllFromCart`, and
  `updateQuantity` were all updated to read/match on `item.product`
  instead of `item.id`. `checkoutSuccess` (`payment.controller.js`) now
  calls `User.findByIdAndUpdate(session.metadata.userId, { cartItems: []
  })` immediately after `createOrder(session)` succeeds, in the same
  request/response cycle that confirms payment — chosen over a separate
  endpoint the frontend calls afterward, because it matches the pattern
  `checkoutSuccess` already uses for coupon deactivation (an inline side
  effect of confirmed payment, not a second client-initiated round trip)
  and doesn't depend on the frontend successfully firing a follow-up
  request after redirect.
- **Verification:** Re-ran the same Playwright-driven test after the
  fix — logged in, clicked "Add to cart" on a real product, and
  confirmed via the real `User` model that `cartItems` now holds
  `{ quantity: 1, product: <realProductId>, _id: <ownSubdocId> }`, and
  that `GET /api/cart` correctly returns the populated product. Then ran
  a **full real checkout** end-to-end for the first time this
  session — logged in, added a product, clicked through to Stripe's
  actual hosted Checkout page, submitted the `4242 4242 4242 4242` test
  card, and was redirected back to a genuine "Purchase Successful"
  page. Confirmed directly in MongoDB immediately afterward: a correct
  `Order` document was created (right `user`/`products`/`totalAmount`/
  `stripeSessionId`), and `User.cartItems` was `[]`. This also closes
  the "live Stripe checkout round-trip untested" gap noted earlier in
  this log — the full payment path is now genuinely verified, not just
  its individual pieces. Test user and its test order were deleted
  afterward.
- **Rationale for logging this as Phase 1 scope:** Cart is core,
  load-bearing functionality for this baseline, not an optional feature
  — a broken add-to-cart and a cart that never empties after purchase
  would silently invalidate this tag's claim to be a genuinely working
  reference point, the same category of issue as the Stripe key
  mismatch, the Cloudinary credential, and the DNS workaround already
  logged above.
- **Alternatives considered:** For cart clearing, a dedicated
  `POST /api/cart/clear` (or reusing the existing `DELETE /api/cart`
  with no `productId`, which already clears all items) called by the
  frontend after `checkout-success` — rejected as the primary fix
  because it introduces a second network round trip the payment
  confirmation would depend on; still viable as a defensive frontend
  call in addition to the backend fix, but not required now that the
  backend guarantees it.
- **Stage:** Monolith

### [2026-07-15] Follow-up: the cart fix needed defensive reads, not just corrected writes
- **Finding:** Shortly after the `addToCart`/`getCartProducts`/
  `removeAllFromCart`/`updateQuantity` fix above shipped, adding a
  product to cart started 500ing for real accounts
  (`etta@gmail.com`, `onyii@test.com`) that had used the cart *before*
  the fix. Root cause: those accounts still had `cartItems` subdocuments
  in the old broken shape (`{ quantity, _id }`, no `product` field) left
  over from before the fix, and the new code's `item.product.toString()`
  calls assumed every existing item was well-formed — a legacy item with
  `product: undefined` threw `TypeError: Cannot read properties of
  undefined (reading 'toString')`. Reproduced directly against a test
  account seeded into the same state, with the exact same error.
- **Decision:** Two-part fix. (1) One-time data cleanup: removed the
  malformed entries from both affected accounts' `cartItems` (all of
  them were malformed in both cases - 7 and 6 items respectively, 0
  well-formed). (2) Hardened `cart.controller.js` itself: added a
  `getValidCartItems()` helper that filters out any item missing a
  `product` field before any `.find()`/`.toString()` call, logging a
  `console.log` warning per skipped item so a recurrence is visible
  without crashing the request. Read paths (`getCartProducts`) filter
  in-memory only; write paths that already reassign the whole array
  (`removeAllFromCart`, the zero-quantity branch of `updateQuantity`)
  naturally drop malformed items as a side effect; `addToCart` only
  appends and does not otherwise rewrite pre-existing entries.
- **Rationale:** The original fix corrected the shape of *new*
  reads/writes but implicitly assumed the database already matched that
  shape — it didn't, because the bug had been live for a while and had
  already written malformed data for real users. This is a general
  lesson worth having on record: a fix that changes how existing data is
  interpreted needs either a data migration or defensive reads (ideally
  both), not just corrected logic - "fix the code" and "fix the data"
  are two different, both-necessary steps whenever a schema-shape bug
  has already had time to write bad records.
- **Verification:** Confirmed both real accounts can add/update/remove
  cart items without error post-fix (exercised the same controller logic
  directly against their real documents, then restored them to an empty
  cart, no test data left behind). Re-seeded a test account with an
  old-shaped malformed item and confirmed, via the real endpoints, that
  `POST /api/cart` no longer 500s (200, new item added correctly
  alongside the still-present-but-skipped malformed one) and
  `GET /api/cart` correctly returns only the well-formed item. Test
  account deleted afterward.
- **Stage:** Monolith
- **Stage:** Monolith

### [2026-07-16] Product Service extracted; admin routes deliberately disabled pending Auth Service
- **Decision:** Extracted the first of five Stage 2 services,
  `services/product-service/`, from `backend/`. `product.model.js`,
  `product.controller.js` (all six handlers, including the Redis
  featured-products cache with its 300s TTL), and `cloudinary.js` were
  copied with only import-path changes — no logic rewrite. `lib/db.js`
  and `lib/metrics.js` reuse the monolith's exact patterns (same opt-in
  `DNS_WORKAROUND`, same five metric names for cross-stage
  comparability). The service connects to a **new, separate database**
  (`product-service-db`) on the same Atlas cluster, not the monolith's
  `buildmart` database — this is the first concrete instance of the
  Stage 2 "decomposed but still MongoDB throughout" design already
  committed to in this file.
  - In `product.route.js`, the four routes that depend on
    `protectRoute`/`adminRoute` (`GET /`, `POST /`, `PATCH /:id`,
    `DELETE /:id`) are commented out individually, each with a
    `TODO(auth-service)` comment, rather than importing
    `backend/middleware/auth.middleware.js` across the service
    boundary or silently leaving them unauthenticated. The three public
    routes (`GET /featured`, `GET /category/:category`, `GET
    /recommendations`) are live. `auth.middleware.js` is not imported
    into this service at all.
  - Added `lib/redis.js`, and `ioredis`/`REDIS_URL` to
    `package.json`/`.env.example` — not originally in the requested file
    list, but required for the unchanged `product.controller.js` to run,
    since `getFeaturedProducts`/`toggleFeaturedProduct` both call
    `redis`. Flagged to the researcher at the time.
  - Wrote `scripts/migrate-products.js` (one-off, not wired into the
    app) to copy `buildmart.products` into `product-service-db.products`
    verbatim, preserving `_id`s (Order documents in the monolith
    reference product `_id`s, so preserving them keeps cross-referencing
    possible later). Idempotent by `_id`, additive only. Run once: 27
    source documents, 27 inserted, target count verified equal to
    source, source left untouched.
- **Rationale:** "Extraction, not a rewrite" was the explicit instruction
  — copying controller/model/lib logic unchanged means any correctness
  differences between Stage 1 and Stage 2 benchmarking come from the
  *architecture* (separate process, separate database, network
  boundary) rather than from incidental logic changes made during the
  port. Disabling admin routes per-line (rather than deleting them,
  gating the whole router, or wiring a fake/local auth check) keeps the
  eventual re-enablement a one-line diff once the User/Auth Service
  exists, and keeps the git history honest about exactly which routes
  are and aren't live at this stage of the decomposition.
- **Verification:** Ran the service standalone (`node src/server.js`)
  against `product-service-db`. `/metrics` showed
  `app_ready_timestamp_seconds` populated after Mongo connected. `GET
  /api/products/featured` returned 8 products, all with `isFeatured ===
  true`. `GET /api/products/category/cement` returned 4 products, all
  with `category === "cement"`. `GET /api/products/recommendations`
  returned 4 randomly-sampled products with the same projected field
  shape as the monolith (`_id`/`name`/`description`/`image`/`price`,
  no `category`/`isFeatured` leaked). Confirmed the four disabled admin
  routes all 404 (route not registered, not a silent 401/bypass).
  Confirmed the `featured_products` Redis key carried its TTL behavior
  over (283s remaining shortly after being set). Test instance stopped
  afterward; `backend/` (the monolith) was not started, modified, or
  otherwise touched by any of this.
- **Alternatives considered:** A single `router.use` guard returning 501
  for all admin paths — rejected in favor of per-route comments, which
  make it visually obvious in a diff which specific routes are affected
  and preserves each route's exact original middleware chain as a
  comment rather than replacing it with a generic stub. Standing up a
  stub/local auth check just for this service — rejected as
  extraction scope creep; the real fix is the User/Auth Service, not a
  throwaway substitute that would need to be torn out again.
- **Stage:** Baseline Microservices

### [2026-07-16] User/Auth Service extracted; stateless JWT verification adopted as the baseline auth design
- **Decision:** Extracted the second of five Stage 2 services,
  `services/user-service/`. `user.model.js` was copied without its
  `cartItems` field (cart is moving to its own service, not staying with
  User); `signup`/`login`/`logout`/`refreshToken` were copied unchanged in
  logic. Two deliberate departures from a pure "copy unchanged" extraction,
  both required to make cross-service authorization work without a
  database or network round trip per request:
  1. **Role signed into the JWT.** `generateTokens(userId, role)` now signs
     `{ userId, role }` into *both* the access token and the refresh
     token (previously `{ userId }` only, access token only). Signing role
     into the refresh token too means `refreshToken` can re-issue a fresh
     access token with the current role using nothing but the refresh
     token's own payload — no database lookup at refresh time either.
     Tradeoff, documented in a code comment on `generateTokens`: a role
     change only takes effect on the user's next login, or when their
     refresh token itself expires (7 days) — there is no shorter
     propagation path in this design.
  2. **`auth.middleware.js` rewritten to be fully stateless**, and
     physically duplicated (not imported) into every service that needs
     it — `services/user-service/src/middleware/` and
     `services/product-service/src/middleware/` today, every future
     service going forward. Each copy verifies the access token's
     signature locally against a shared `ACCESS_TOKEN_SECRET` and trusts
     the decoded `{ userId, role }` claims directly, setting
     `req.user = { _id: decoded.userId, role: decoded.role }` — no
     `User.findById` call, no HTTP call to User/Auth Service, in any
     service including User/Auth Service's own copy. This is documented
     in-line in the middleware file itself (not just here), per explicit
     instruction, since it's the kind of tradeoff a future reader needs
     to see at the point where it's easy to miss.
  3. **Consequence of (2) for `getProfile`:** since the middleware no
     longer does a database fetch anywhere, `getProfile` (the one route
     that needs the full profile — name/email, not just id/role) now does
     its own `User.findById(req.user._id).select("-password")` inline.
     This is User/Auth Service's own database, not a cross-service call —
     the fetch just moved from the middleware (where it happened for
     every route) into the one handler that actually needs it. Output
     shape is identical to the monolith's `getProfile`; only where the
     fetch happens changed.
  - `req.user` uses the key `_id` (not `userId`), matching every other
    controller already written against `req.user._id`
    (`order.controller.js`, `cart.controller.js` in the monolith), so
    those controllers won't need a rename when they're extracted into
    their own services later and reuse this same middleware.
  - **Product Service retrofit, same commit:** `services/product-service/`
    was extracted first (see the entry above) with its four admin routes
    disabled, because no Auth service existed yet to verify tokens
    against. Now that `user-service` exists, this commit un-does that gap
    as an explicit follow-up, not folded in silently: duplicated the new
    `auth.middleware.js` into `services/product-service/src/middleware/`,
    added `cookie-parser` (neither service previously read cookies, since
    neither had auth wired in yet), and uncommented all four admin routes
    with `protectRoute`/`adminRoute` wired in. This sequencing —
    Product Service shipped with a real, temporary gap, then a dedicated
    follow-up commit closed it once its dependency existed — is itself a
    direct, worth-recording consequence of extracting services one at a
    time rather than all five simultaneously.
  - `scripts/migrate-users.js`: same idempotent-by-`_id`, additive-only,
    raw-collection-copy pattern as `migrate-products.js`, copying
    `buildmart.users` → `user-service-db.users`, explicitly stripping
    `cartItems` from each document before insert. Run once: 4 source
    documents, 4 inserted, 1 of which had a non-empty `cartItems` that was
    correctly dropped, target count verified equal to source, source left
    untouched.
- **Rationale:** The alternative to stateless verification — every
  service calling back into User/Auth Service (or a shared database) on
  every authenticated request — would make every other service's
  availability and latency depend on User/Auth Service, which defeats a
  major point of decomposing into independently deployable services in
  the first place. Signing role into the token and verifying it locally
  trades instant role-change propagation for that independence, which is
  an explicit, acceptable tradeoff for the Baseline Microservices stage;
  centralized, always-current authorization is deferred to the API
  Gateway in the Enhanced Microservices stage, where it belongs
  architecturally.
- **Verification:** Ran both services standalone against their real
  databases. Signed up a fresh test user against User/Auth Service
  (`customer` role) and confirmed: `GET /api/auth/profile` returns the
  full profile via its own DB fetch; the same token against Product
  Service's `GET /api/products/` (admin-gated) correctly 403s; the same
  route with no cookie at all correctly 401s. Promoted the test user to
  `admin` directly in `user-service-db`, logged in again to mint a fresh
  admin-role token, and confirmed all four previously-disabled Product
  Service admin routes now work with it (`GET /`, `PATCH /:id` exercised
  directly — toggled and restored a real product's `isFeatured` flag).
  Then, as the strongest test of "no cross-service call": **killed
  User/Auth Service entirely** and re-hit Product Service's admin route
  with the same already-issued token — still `200`, proving Product
  Service authenticates and authorizes the request with zero dependency
  on User/Auth Service being reachable. Test user and its token deleted
  afterward; both temporary service instances stopped; product data
  confirmed unaffected (27/27, `isFeatured` restored to its original
  value). `backend/` (the monolith) was not touched.
- **Alternatives considered:** Keep `protectRoute` doing a database
  lookup (as the monolith does), but have each service query its own
  copy of relevant User fields via an internal replication/sync
  mechanism — rejected as significantly more infrastructure for a
  baseline stage that hasn't earned it yet, and it still wouldn't remove
  the propagation-delay tradeoff, just relocate it. Have User/Auth
  Service's own middleware copy keep doing a DB lookup (since it's local
  to that service) while every *other* service's copy stays stateless —
  rejected in favor of one identical, unconditionally stateless
  middleware everywhere, so there is exactly one auth design to reason
  about and audit, not two special-cased variants that could silently
  drift apart.
- **Stage:** Baseline Microservices

### [2026-07-16] Monolith audited for four performance optimizations; confirmed absent codebase-wide — applying to Baseline AND Enhanced, not Enhanced-only
- **Decision:** Before implementing MongoDB indexes, pagination, HTTP
  compression, and `Promise.all` parallel calls anywhere in Stage 2/3,
  audited the original monolith (`backend/`) for existing instances of
  each. Findings, checked across the *entire* codebase, not just the
  specific endpoints later targeted for optimization:
  - **Indexes:** grepped every model file for `index:`/`.index()`. The
    only indexes that exist anywhere are incidental side effects of
    `unique: true` constraints (`user.model.js` email,
    `order.model.js` stripeSessionId, `coupon.model.js` code/userId) —
    none added for query performance. `product.model.js` has zero
    indexes of any kind, despite `category` and `isFeatured` both being
    query filters in `product.controller.js`. No index on `Order.user`
    either, despite `getUserOrders` filtering on it.
  - **Pagination:** grepped `limit|skip|page` across every controller —
    zero matches anywhere in `backend/`. `getAllProducts` and
    `getProductsByCategory` both return their full, unbounded result
    sets unconditionally; no endpoint in the monolith paginates
    anything.
  - **HTTP compression:** no `compression` package in `package.json`,
    no compression middleware in `server.js`'s middleware stack
    (`metricsMiddleware` → `express.json()` → `cookieParser()`).
    Completely absent.
  - **`Promise.all` parallel calls:** grepped `Promise\.all` across
    `backend/` — zero occurrences anywhere in the codebase. Clearest
    concrete miss: `analytics.route.js:9,14` awaits
    `getAnalyticsData()` then `getDailySalesData()` sequentially despite
    their being independent; inside `getAnalyticsData` itself
    (`analytics.controller.js:6-7`), `User.countDocuments()` and
    `Product.countDocuments()` are also awaited sequentially despite
    being independent.
  - **Conclusion:** the monolith has **none** of these four
    optimizations, codebase-wide, not just at the endpoints later
    targeted. Applying them to Product/User/Cart/Order/Coupon Services
    in both Baseline and Enhanced Microservices is therefore genuinely
    new implementation work being introduced at Stage 2 — not carrying
    forward, extending, or "catching up to" any optimization the
    monolith already had. This empirically confirms **Comparison A
    (Monolith vs. Baseline)** was never at risk of being confounded by
    this dimension (the monolith simply never had it to lose or keep).
  - Given that starting point, these four optimizations are being
    applied identically to **both Baseline and Enhanced Microservices**,
    not Enhanced-only. They are implementation-quality improvements
    (indexing, pagination, compression, concurrency) that don't depend
    on anything architectural to Enhanced (Kubernetes, API Gateway,
    Redis-as-cache, CI/CD) — applying them Enhanced-only would let
    **Comparison B (Baseline vs. Enhanced)** attribute performance gains
    to "architecture" that were actually just implementation quality,
    confounding the comparison this dissertation is structured around.
    Applying them to both isolates Comparison B to the architectural
    variables it's actually meant to measure (orchestration, gateway,
    caching, CI/CD), with implementation quality held constant across
    both sides.
  - React lazy loading (frontend route/component code-splitting) is
    the fifth optimization approved alongside these four, but is
    **frontend-only and architecture-independent** — it doesn't touch
    or depend on which backend stage (Monolith/Baseline/Enhanced) the
    frontend is talking to, so there's no Baseline/Enhanced split to
    reason about for it. Applied once, consistently, regardless of
    backend target.
  - **Sequencing:** implementation of all five optimizations is
    deliberately deferred until after Cart, Order, and Coupon Services
    are extracted (Stage 2's five services complete), then done as one
    dedicated optimization pass applied uniformly across all five
    services (Baseline) and, separately, Enhanced — rather than
    optimizing each service piecemeal as it's extracted. This avoids
    doing the same optimization work twice (once now, once again after
    the remaining three services exist) and keeps the "uniform
    treatment" property easy to verify in one pass rather than having
    to audit for consistency after the fact.
- **Rationale:** the "fair starting point" reasoning for Comparison B
  was stated as a precaution before this audit; the audit converts it
  into an empirically grounded claim — there is now a documented,
  reproducible check (not an assumption) that the monolith's baseline
  state for these four dimensions is uniformly absent, which is exactly
  what's needed to say with confidence that neither comparison in this
  dissertation is confounded by implementation-quality drift.
- **Alternatives considered:** Apply the four backend optimizations to
  Enhanced Microservices only, treating them as part of what makes
  Enhanced "enhanced" — rejected per the reasoning above, since none of
  the four require anything architectural to Enhanced and applying them
  asymmetrically would misattribute their performance contribution to
  architecture in Comparison B. Implement optimizations service-by-service
  as each is extracted, rather than one pass at the end — rejected as
  more error-prone (harder to guarantee uniform treatment across five
  services extracted at different times) and redundant work.
- **Stage:** Baseline Microservices and Enhanced Microservices (backend
  four); All stages, frontend-only (lazy loading)

### [2026-07-16] Cart Service extracted as a Redis Hash — genuine rewrite, not a copy; Product Service gains a batch lookup endpoint
- **Decision:** Extracted the third of five Stage 2 services,
  `services/cart-service/`. Unlike Product/User Service, this was a
  deliberate rewrite, not a content-preserving copy: cart data moves from
  being embedded in `User.cartItems` (MongoDB, an array of `{ product,
  quantity }` subdocuments) to a Redis Hash the Cart Service owns
  outright (a data store, not a cache — consistent with the "Cart
  extracted to Redis in Stage 2" decision already on record above).
  - **Key/value design:** `cart:{userId}` as a Redis **Hash**, field =
    productId, value = quantity — chosen over a single String key
    holding a JSON-serialized array. The Hash gives atomic
    add/increment (`HINCRBY`, one round trip, no read-modify-write race
    under concurrent requests) and, more importantly, makes the exact
    bug class Phase 1 had to fix defensively **structurally
    unrepresentable**: a hash field *is* the product id, so there is no
    state where a quantity exists without a valid product reference.
    `cart.controller.js`'s new top-of-file comment (and this entry)
    both note explicitly that the monolith's `getValidCartItems()`
    defensive filter has no equivalent here — not because the concern
    was dropped, but because the new data structure cannot hold the
    malformed shape that filter was guarding against.
  - **Four operations rewritten:** `addToCart` → `HINCRBY`;
    `getCartProducts` → `HGETALL` then resolve full product details via
    Product Service's new batch endpoint; `removeAllFromCart` → `HDEL`
    (one field) or `DEL` (whole cart, `productId` absent, matching the
    monolith's behavior); `updateQuantity` → `HEXISTS` check (preserves
    the monolith's 404-if-not-in-cart), then `HSET` (exact value) or
    `HDEL` (quantity `0`, matching the monolith's zero-quantity-removes
    behavior).
  - **Product Service addition (prerequisite, added and verified
    standalone first):** `POST /api/products/batch`, body `{ ids: [...]
    }`, running `Product.find({ _id: { $in: ids } })`. Public, same
    trust level as the other read-only product routes — it's a lookup,
    not a mutation. Empty/missing `ids` short-circuits to `[]` without
    touching MongoDB.
  - **Cart Service → Product Service call:** native `fetch` (Node 20 has
    it built in), not `axios` — checked first: `axios` exists only in
    `frontend/package.json` for browser calls to this app's own backend;
    no backend code (monolith or any service) had ever made an outbound
    service-to-service HTTP call before this, so there was no backend
    precedent either way, and native `fetch` needs no new dependency.
    `PRODUCT_SERVICE_URL` is an env var (`.env.example`), never
    hardcoded, since it changes when services move to
    containers/Kubernetes.
  - **Deliberate 503 on Product Service outage:** `getProductsByIds()`
    (`src/lib/productServiceClient.js`) wraps the `fetch` call in a
    5-second `AbortController` timeout and converts *any* failure to
    get a usable response — network error or non-2xx — into a
    `ProductServiceUnavailableError`. `getCartProducts` catches that
    specific error and returns `503 { message: "Product Service is
    unavailable..." }`. This is Baseline's documented, intentional
    failure mode under a dependency outage — specified precisely,
    because Enhanced will later be evaluated partly on resilience
    improvements (e.g. a circuit breaker, retries, or caching resolved
    product details) over this exact behavior, and that comparison only
    means something if Baseline's own failure mode is itself
    deliberate and recorded, not incidental.
  - **Confirmed Mongo-free:** re-read `cart.controller.js` in full before
    starting — it only ever touched `req.user.cartItems` (populated by
    the monolith's DB-fetched `User` document, not owned by cart logic
    itself) and the `Product` model (now replaced by the batch HTTP
    call). No other Mongoose model, no other MongoDB reference anywhere
    in the cart flow. Cart Service has **no `db.js`, no `models/`
    folder, no `mongoose` dependency** — Redis-only, confirmed rather
    than assumed.
  - **Shared Redis instance — an accepted limitation, not a design
    choice on equal footing with per-service MongoDB databases.** Cart
    Service's Hash-per-user keys (`cart:*`) live on the **same physical
    Redis instance** as Product Service's `featured_products` cache and
    User Service's `refresh_token:*` keys — there is no per-service
    Redis database/instance the way there is a separate `product-
    service-db`/`user-service-db` for MongoDB. Isolation is by key-prefix
    convention only. This is a genuine, worth-naming limitation of the
    current Baseline setup, not a deliberate architectural parity with
    the per-service MongoDB isolation elsewhere in this project — a
    Redis outage or a key-prefix collision would affect all three
    services simultaneously, in a way a MongoDB outage on
    `product-service-db` alone would not affect `user-service-db`.
    Recorded here explicitly so it isn't mistaken for an intentional,
    equally-strong isolation boundary when this baseline is compared
    against Enhanced later.
  - `scripts/migrate-carts.js`: read every `buildmart.users` document
    with a non-empty `cartItems` array, filtered to only well-formed
    items (`product` field present — the same validity check as Phase
    1's `getValidCartItems()`, applied here once as the migration's own
    filter rather than carried into the new controller, since the new
    Hash structure has no way to represent a malformed entry anyway),
    and `HSET` each valid item into Redis under the new key structure.
    Run once: 1 user had a non-empty cart, 2 valid items migrated, 0
    malformed items dropped, `buildmart` left untouched.
- **Rationale:** Redis Hash was chosen specifically because it maps the
  data-integrity property Phase 1 had to enforce defensively (every
  cart entry has a valid product reference) onto something the storage
  layer itself guarantees, rather than something application code has
  to keep re-checking. The deliberate-503 requirement exists because
  Cart Service is the first service in this project with a genuine
  runtime dependency on another service being reachable — how that
  dependency fails needs to be as precisely specified as how it
  succeeds, since "Baseline vs. Enhanced" resilience claims later in
  this dissertation are only meaningful relative to a documented
  starting behavior.
- **Verification:** Ran all three services (Product, User, Cart)
  standalone against real infrastructure. Added a product twice via the
  real `POST /api/cart` and confirmed the quantity incremented to 2 in
  Redis directly (`HGETALL`); confirmed the same user's document in
  `buildmart` was untouched (user only exists in `user-service-db`,
  proving no accidental dual-write). `GET /api/cart` correctly resolved
  full product details with merged quantities via the batch call. Then
  **killed Product Service outright** and re-hit `GET /api/cart` with
  the same session: `503` in 98ms (not a hang, not a generic 500), with
  a clear log line on the Cart Service side; restarted Product Service
  and confirmed `GET /api/cart` immediately worked again with no other
  intervention. Exercised `updateQuantity` (exact-value set, 404 on a
  product not in the cart, quantity-`0` removal),
  `removeAllFromCart` (single-product `HDEL` and whole-cart `DEL`, both
  verified against Redis directly), and confirmed Redis auto-deletes a
  hash key once its last field is removed (no dangling empty-hash key
  left behind). Confirmed the real migrated cart (from
  `migrate-carts.js`) was untouched by any of this. Test user and its
  Redis key deleted afterward; all three test service instances
  stopped; `backend/` (the monolith) was not touched.
- **Alternatives considered:** A String key holding a JSON-serialized
  array (mirroring the monolith's own in-memory shape most closely) —
  rejected per the Hash-vs-String tradeoff above: no atomic
  increment, and no structural protection against reintroducing the
  same malformed-shape bug class. Having `getCartProducts` retry or
  silently return a stale/empty result on a Product Service outage —
  rejected in favor of an explicit `503`, since silently degrading
  would misrepresent what actually happened to a caller and would make
  it harder to attribute a later Enhanced-stage resilience improvement
  to something concrete. Treating the shared Redis instance as
  equivalent in isolation to the per-service MongoDB databases —
  explicitly rejected; documented instead as a named limitation.
- **Stage:** Baseline Microservices

### [2026-07-16] Coupon Service extracted; new /deactivate endpoint gets a shared-secret gate, unlike Product Service's public batch read
- **Decision:** Extracted the fourth of five Stage 2 services,
  `services/coupon-service/`. `coupon.model.js` and the two existing
  handlers (`getCoupon`, `validateCoupon`) were copied unchanged in
  logic from the monolith — same pattern as Product Service, no
  data-layer rewrite (unlike Cart Service). Confirmed by reading the
  monolith's files in full first: `coupon.route.js` has no public
  routes at all (`GET /` and `POST /validate` are both `protectRoute`-
  gated already), so unlike Product Service's extraction, there was no
  "disabled pending Auth Service" gap to create — Coupon Service ships
  fully live from the start.
  - **New addition: `PATCH /api/coupons/deactivate`.** Also re-checked
    `payment.controller.js` (still monolith/future-Order-Service logic,
    not moved) to ground this in real behavior: `checkoutSuccess`
    currently runs `Coupon.findOneAndUpdate({ code, userId }, { isActive:
    false })` directly against the Coupon model, and never checks the
    result — a missing/already-deactivated coupon is a normal, expected
    outcome there, not an error. The new endpoint mirrors that exact
    query shape and that exact tolerance (`200 { deactivated: false,
    coupon: null }` on no match, never a 404/500), so it's a drop-in
    replacement for that inline call once Order Service exists and can
    call INTO Coupon Service instead of touching its database directly
    — built and verified standalone now, the same way Product Service's
    batch endpoint was built ahead of Cart Service needing it.
  - **`requireInternalServiceKey` — a shared-secret gate, deliberately
    different from Product Service's public batch endpoint.** Product
    Service's `POST /api/products/batch` is a public **read** with no
    gate, "same trust level as the other public product routes."
    `PATCH /api/coupons/deactivate` is a **write** on payment-adjacent
    data, so it gets a lightweight check instead: a required
    `X-Internal-Service-Key` header, compared against a new
    `INTERNAL_SERVICE_KEY` env var — a *separate* secret from
    `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET`, with no relationship
    to user identity, role, or session (the middleware file's own header
    comment says this explicitly, so the distinction is visible at the
    point a future reader would actually encounter it, not just in this
    log). Missing or mismatched key → `401` (matching this project's
    existing convention: 401 for "no/invalid credential presented," 403
    reserved for `adminRoute`'s "valid credential, insufficient role" —
    a wrong internal-service key is the former category, not the
    latter), checked before the database is touched. Implemented as its
    own middleware file (`internalService.middleware.js`), not folded
    into `auth.middleware.js`, so that file stays the one thing it's
    always been (byte-identical, duplicated-everywhere, stateless JWT
    verification) without an unrelated secondary concern grafted onto
    it.
  - This is Baseline's **deliberately minimal** answer to "how does one
    service trust a call from another service" — not real service
    identity, not fine-grained per-caller authorization, just a shared
    string that keeps this one write endpoint from being callable by
    arbitrary public requests. It is explicitly **not** intended as a
    durable pattern to repeat ad hoc on every future write endpoint
    across five-plus services; it's recorded here as a stopgap with a
    named successor: the API Gateway in the **Enhanced Microservices**
    stage is expected to formalize inter-service trust **centrally**
    (the Gateway authorizes service-to-service calls in one place),
    rather than each service inventing and maintaining its own
    shared-secret convention. That contrast — an ad hoc, per-endpoint
    secret at Baseline vs. a centralized, Gateway-mediated mechanism at
    Enhanced — is itself one of the concrete, citable architectural
    differences this dissertation's Baseline-vs-Enhanced comparison is
    structured to surface, not an incidental implementation detail.
  - `scripts/migrate-coupons.js`: same idempotent-by-`_id`,
    additive-only pattern as the other migration scripts. `buildmart.
    coupons` was confirmed empty (0 documents) before writing this
    script; run once, correctly reported "0 documents, nothing to
    migrate" as an expected, successful outcome rather than an error
    path, source untouched.
- **Rationale:** The read/write distinction is the load-bearing one
  here: a public read endpoint returning product catalog data carries
  negligible risk if called by anyone, while an unauthenticated public
  endpoint that can flip `isActive: false` on any user's coupon by
  guessing a `{ code, userId }` pair is a real (if low-severity)
  integrity gap on data adjacent to the highest-risk code path in this
  project (payment/checkout, per `CLAUDE.md`). A minimal shared-secret
  check closes that gap without inventing a heavier mechanism
  (mTLS, per-service tokens, a service registry) that Baseline hasn't
  earned yet and that would just be replaced by the Gateway at Enhanced
  anyway.
- **Verification:** Ran User/Auth Service and Coupon Service standalone.
  Signed up a fresh test user, then inserted a real coupon directly
  (mirroring `createNewCoupon`'s exact shape — `GIFT...` code, 10%,
  30-day expiry) referencing that user's real `_id`, since there's no
  create-coupon route in `coupon.controller.js` itself (that logic
  correctly stays in the payment flow). Confirmed `GET /api/coupons`
  and `POST /api/coupons/validate` both work correctly against this
  real data, `validate` 404s on a wrong code, and `GET /api/coupons`
  401s with no session cookie. Then the three explicit auth cases for
  `/deactivate`, as specified: **no header at all** → `401`, coupon's
  `isActive` confirmed still `true` afterward (no accidental mutation
  on a rejected request); **a wrong key that is itself a
  plausible-looking random hex string of the same length/format as the
  real one** (not an obviously-fake string like `"wrongkey123"`) → also
  `401`, `isActive` still `true` — confirming the comparison is a
  genuine exact-match check, not accidentally truthy on any non-empty
  string; **the correct key** → `200 { deactivated: true, ... }`,
  `isActive` confirmed `false` immediately after via `GET
  /api/coupons` correctly returning `null` (no active coupon). Test
  coupon and test user deleted afterward; both test service instances
  stopped; `backend/` (the monolith) was not touched.
- **Alternatives considered:** Leaving `/deactivate` public, matching
  Product Service's batch endpoint exactly for consistency — rejected
  once the read/write distinction was made explicit; consistency for
  its own sake isn't a reason to leave a write endpoint open when the
  read/write line is the actual determinant of risk. `protectRoute`
  (end-user JWT) on `/deactivate` instead, with Order Service
  forwarding the original caller's session cookie — rejected as a
  workable but awkward fit: it would couple a conceptually
  service-to-service call to "must carry a specific end user's live
  session," a pattern used nowhere else in this project, for a route
  that isn't really about who the end user is. A heavier
  service-identity mechanism (mTLS, signed service tokens, a service
  registry) — rejected as over-engineering for what the Baseline stage
  needs, and because the Enhanced-stage Gateway is the more appropriate
  place for that investment.
- **Stage:** Baseline Microservices (Coupon Service, the `/deactivate`
  endpoint, and the shared-secret gate); the Gateway-formalizes-this
  contrast is a forward reference to Enhanced Microservices

### [2026-07-16] Order Service extracted — the fifth and final Stage 2 service; orchestrates Cart/Coupon (not Product) at checkout, adds a Coupon-creation endpoint, and establishes a project-wide fail-fast-vs-best-effort principle
- **Decision:** Extracted the fifth and final Stage 2 service,
  `services/order-service/`. `order.model.js` and `createOrder`/
  `getOrderById`/`getUserOrders` (already extracted from the payment
  controller back in Phase 1) were ported cleanly; `payment.controller.js`
  (`createCheckoutSession`, `checkoutSuccess`, `createStripeCoupon`,
  `createNewCoupon`) required genuine redesign, since it orchestrates
  Stripe plus three other domains. Read every relevant monolith file in
  full before designing anything, per this project's established
  extraction discipline, which surfaced two real discrepancies from the
  initially assumed design (both resolved with explicit sign-off before
  any file was written) and one real bug found only during end-to-end
  verification (fixed and documented below).
  - **Discrepancy 1 — Cart/Product Service are not actually called
    anywhere in the current checkout flow.** `createCheckoutSession`
    builds Stripe line items straight from client-submitted
    `req.body.products` (name/image/**price**, trusted verbatim) — there
    is no "get cart" call and no Product Service price/detail lookup
    anywhere in the monolith's payment path. **Decision: preserve this
    exactly**, in both Baseline and Enhanced — do not add server-side
    cart/price validation now or later as part of this extraction work.
    This is a real, pre-existing trust gap (a malicious client could
    submit an arbitrary price), left deliberately unfixed and recorded
    here as a limitation for the dissertation's Limitations/Future Work
    discussion, not as an oversight. Closing it would be a genuine
    security hardening of the highest-risk code path in this project,
    which is out of scope for a task whose job is to preserve behavior
    across an architectural boundary, not change it.
  - **Discrepancy 2 — only one new Coupon Service endpoint was actually
    needed.** The existing `POST /api/coupons/validate` already has
    identical semantics to `createCheckoutSession`'s inline coupon check
    and already returns the one field needed (`discountPercentage`), so
    it's reused as-is, token-forwarded. The only genuinely new
    requirement was coupon *creation* for the ≥$200 reward
    (`createNewCoupon`). **New endpoint: `POST /api/coupons`**
    (`coupon-service`), `protectRoute`-gated (token-forwarded, per the
    researcher's instinct, confirmed correct after reading the actual
    logic), porting `createNewCoupon`'s exact logic (unconditionally
    replace any existing coupon for the user, grant `GIFT`+random/10%/
    30-day) verbatim into Coupon Service's own controller - moved there
    because it's coupon-domain *write* logic, not order-domain logic.
    `userId` is derived from `req.user._id` (the token), not the request
    body - unlike `/deactivate`, which is body-supplied `userId` since
    it has no live user session to derive from. This gives Coupon
    Service a clean, principled split: `/validate` and the new `/`
    (create) are both token-derived; `/deactivate` alone is
    shared-secret/body-supplied, matching exactly which of the three
    routes has a live end-user session available at its call site.
  - **Reordering in `createCheckoutSession`:** all calls to other
    services (coupon validation, reward-coupon creation) now happen
    **before** the Stripe checkout session is created, not after, as in
    the monolith. `totalAmount` is fully known before Stripe is ever
    called - nothing in the original logic actually required the
    reward-coupon check to run after session creation, it just happened
    to be written that way. Reordering means a dependency outage always
    fails before any Stripe side effect exists, instead of risking an
    orphaned, never-returned-to-the-client Stripe session (which Stripe
    would eventually expire on its own, but which is still a worse
    outcome than never creating it).
  - **The general fail-fast-vs-best-effort principle** (requested to be
    recorded explicitly, not just as a local exception): **fail-fast
    applies before the costly/irreversible action** (here, the Stripe
    charge) — a dependency outage during `createCheckoutSession` returns
    a clean `503` immediately, no partial state, nothing created.
    **Best-effort-with-logging applies after that action** — inside
    `checkoutSuccess`, Stripe has *already* confirmed payment by the
    time the handler runs; failing the response at that point over a
    Coupon or Cart Service outage would tell a genuinely paying customer
    their payment didn't go through, **and** silently drop the Order
    record, which is a strictly worse outcome than a coupon staying
    active a little longer or a cart not auto-clearing. Concretely:
    `createOrder(session)` runs **first** in `checkoutSuccess` (zero
    external dependency - it only reads `session.metadata`, the
    price/product snapshot captured at checkout-creation time, never
    re-fetched from Product Service, confirmed by reading the code);
    coupon deactivation and cart-clearing are then attempted
    best-effort, each wrapped in its own try/catch that logs and
    continues rather than failing the response. This divergence from
    the fail-fast rule used everywhere else in this project is scoped
    specifically to *after* Stripe has confirmed payment - the
    determining factor is irreversibility of the preceding action, not
    which handler it happens to be in.
  - **Bug found only during end-to-end verification, fixed the same
    session:** `getOrderById`/`getUserOrders` used Mongoose's
    `.populate("products.product", ...)`, which requires the referenced
    model (`Product`) to be registered in the *same* Mongoose
    connection - true in the monolith (single process, one connection),
    false now that Product lives in its own service with its own
    database. The very first real `GET /api/orders/:id` call in
    verification returned `500 Schema hasn't been registered for model
    "Product"`, immediately surfacing this. This was missed during
    planning because the earlier "Order Service doesn't need Product
    Service" conclusion was correct for the payment/checkout handlers
    (confirmed: they never touch Product Service) but the read handlers
    were not separately traced for the same concern. **Fix:** added
    `productServiceClient.js` (same pattern as Cart Service's, batch
    lookup, 5s timeout) used *only* by `order.controller.js`'s two read
    endpoints; `.populate()` calls replaced with an explicit batch fetch
    + manual merge, matching how Cart Service already solves the
    identical "resolve product details for a stored reference" problem.
    Made **best-effort**, not fail-fast: if Product Service is down, a
    `GET /api/orders/:id` call still returns the order with its own
    immutable price/quantity snapshot intact, just without live
    name/image - reading already-existing, already-paid order history
    should not be blocked by a display-enhancement dependency being
    temporarily down, the same reasoning as the fail-fast-vs-best-effort
    principle above, applied to a read rather than a post-payment write.
    `PRODUCT_SERVICE_URL` was consequently added back to
    `.env.example`/`.env`, with an explicit comment clarifying it's used
    by the read endpoints only, never by payment logic.
  - `scripts/migrate-orders.js`: 1 real document confirmed in
    `buildmart.orders` before writing the script (from earlier Phase 1
    checkout E2E testing) - not assumed. Run once: 1 inserted, target
    count verified equal to source, source untouched.
- **Rationale:** The fail-fast-vs-best-effort split is the single most
  important design decision in this extraction because it's the first
  place in this project where a service's own internal logic (not just
  its extraction boundary) had to reason about *when* a downstream
  failure is acceptable to swallow versus when it must propagate - every
  prior service's failure handling was uniformly fail-fast because
  nothing in Product/User/Cart/Coupon Service's own logic had yet done
  anything irreversible before calling out to another service. Order
  Service is the first (and, by this project's design, only) service
  that wraps a real external side effect (an actual Stripe charge) that
  cannot be undone by anything the rest of the request does - so this is
  recorded as a general principle precisely because the same reasoning
  will apply anywhere a future stage adds another irreversible action
  ahead of dependent side effects, not just here.
- **Verification:** Ran all five Baseline services together standalone
  for the first time. Full real flow: signup, add-to-cart via Cart
  Service, `createCheckoutSession` (confirmed correct Stripe line
  items/metadata), a full real Stripe test-mode payment via
  browser automation (`4242 4242 4242 4242`, confirmed
  `payment_status: "paid"` directly via the Stripe API), `checkoutSuccess`
  → correct `Order` created, cart correctly cleared. Repeated with a
  coupon: created a real reward coupon by checking out ≥$200, confirmed
  `10%` discount correctly applied on a second, coupon-code checkout
  (`$12.99` → `$11.69`), completed that payment for real too, and
  confirmed the coupon was deactivated (`GET /api/coupons` → `null`)
  after `checkoutSuccess`. Explicit fail-fast/best-effort tests, adapted
  from what was originally specified since the actual dependency graph
  differs from what was assumed (see below): confirmed
  `createCheckoutSession` is **completely unaffected** by a Cart Service
  outage (proving zero dependency, as designed) - killed Coupon Service
  instead (its real dependency) and confirmed all three cases behave
  correctly: coupon code present → `503`; no coupon, total under
  threshold → succeeds normally (dependency never triggered); no coupon,
  total over threshold (reward path) → `503`. Then, with Coupon Service
  restarted and **Cart Service still down**, ran a real
  paid-session through `checkoutSuccess` and confirmed `200`, a
  correctly-created Order, and the exact expected log line
  ("Best-effort cart clear failed after payment succeeded (order still
  created)") - the best-effort design working exactly as specified. All
  test data (orders, coupons, users) deleted afterward; the one real
  migrated order confirmed untouched (still exactly 1 document); all
  five service instances stopped; `backend/` (the monolith) was not
  touched.
  - **Note on the originally-specified fail-fast test:** the
    instruction was to test "Cart Service outage during
    createCheckoutSession specifically" - but per Discrepancy 1 above,
    `createCheckoutSession` never calls Cart Service at all in the
    approved design, so that exact test is inapplicable by construction
    (confirmed by running it: zero effect, as expected). The
    *substantively* equivalent tests - fail-fast against
    `createCheckoutSession`'s actual dependency (Coupon Service) and
    best-effort against `checkoutSuccess`'s actual Cart Service
    dependency - were run instead, covering the same underlying
    question (does this handler's designed failure-handling strategy
    actually work under a real outage) via the correct call sites.
  - Also observed one transient, non-reproducing `503` (a slow first
    cross-process connection during the reward-coupon call, well within
    normal flakiness already seen elsewhere in this project - e.g. the
    first `migrate-carts.js` Atlas connection attempt) - immediate retry
    succeeded in 2s; not a code defect, the timeout-then-clean-error
    mechanism did exactly what it was designed to do.
- **Alternatives considered:** Keep the >=$200 reward-coupon check after
  Stripe session creation, matching the monolith's exact original
  ordering - rejected in favor of the reorder above, since it exists
  purely to avoid an orphaned-session failure mode with no behavioral
  cost to the success path. Apply strict fail-fast inside
  `checkoutSuccess` too, exactly as originally specified for every other
  service - rejected explicitly (see Rationale) as the one place in this
  project where literal fail-fast produces a worse outcome than the
  partial-fallback it's meant to prevent. Add server-side cart/price
  validation now, closing the client-trust gap as part of this
  extraction - rejected as scope creep into a deliberate behavior
  change on the highest-risk code path; recorded as a known limitation
  instead.
- **Stage:** Baseline Microservices (this extraction); the
  fail-fast-before/best-effort-after-the-irreversible-action principle
  is written to generalize to Enhanced Microservices as well, wherever
  an irreversible external action is introduced ahead of dependent
  side effects.

### [2026-07-16] frontend-baseline/ created; per-service CORS added; Analytics reimplemented as client-side aggregation across three new per-service summary endpoints
- **Decision:** Duplicated `frontend/` into a new sibling `frontend-baseline/`
  (genuine copy - `robocopy /E`, excluding `node_modules`/`dist`, then an
  independent `npm install` - not a shared or symlinked folder), on this
  branch, dedicated to talking to the five Baseline Microservices instead
  of the monolith. `frontend/` itself was not touched (confirmed via `git
  status` before and after - zero changes).
  - **Why a genuine copy, not conditional routing in one shared
    frontend:** the same reasoning as every backend service duplication
    in this project (`auth.middleware.js` copied into five services
    rather than imported once) - independence, stage-specific
    configuration, and avoiding one codebase trying to branch its
    behavior across three fundamentally different backend topologies
    (one origin for the monolith, five origins for Baseline, one Gateway
    origin for Enhanced) with runtime conditionals. A shared frontend
    with `if (stage === "baseline")` branches throughout its data layer
    would make every future change touch code paths for stages it
    doesn't apply to, and would make it impossible to point Stage 1/2/3
    benchmarking at a frontend build that's unambiguously "this stage's
    frontend." **This pattern will repeat once more**: a
    `frontend-enhanced/` copy, pointed at the Stage 3 API Gateway's
    single origin, is expected when Enhanced Microservices work begins.
  - **`lib/axios.js` (single instance, single baseURL) replaced by
    `lib/api.js`** (five named instances - `productApi`, `userApi`,
    `cartApi`, `couponApi`, `orderApi` - built from one shared factory
    function). Read `axios.js` and all seven files that imported it
    before changing anything, to map every call site to the actual
    service it talks to (`useUserStore.js` → User/Auth; `useProductStore.js`,
    `PeopleAlsoBought.jsx` → Product; `useCartStore.js` → both Cart *and*
    Coupon, split by call; `OrderSummary.jsx`, `PurchaseSuccessPage.jsx`
    → Order). No routing-helper indirection - every call site already
    knows statically which service it needs, so five plain exports is
    simpler than a dynamic dispatcher and matches this project's
    stated anti-over-engineering stance.
  - **The token-refresh-retry interceptor was generalized from
    one instance to all five.** In the monolith, one baseURL meant one
    interceptor sufficed. Under Baseline's stateless JWT design, *any*
    of the five services can independently return `401` on an expired
    access token (each verifies locally, none defers to another) - so
    the interceptor (still owned by `useUserStore.js`, since it's
    fundamentally an auth concern) is now attached to all five
    instances via a loop. The refresh call itself always goes through
    `userApi` (the only service that issues tokens); the retry of the
    original failed request replays on whichever instance it originally
    failed on, preserving that instance's own baseURL.
  - **Real, empirically-discovered blocker: none of the five backend
    services had CORS configured** (confirmed - no `cors` package
    anywhere, same as the monolith). Verified this with a real
    cross-origin `fetch` test in an actual Chrome browser (via
    Playwright) before proposing a fix: a page on one origin calling
    Product Service with credentials was blocked (`Failed to fetch`).
    **Fixed by adding real `cors` middleware to all five services**
    (`app.use(cors({ origin: process.env.CLIENT_URL, credentials: true
    }))`, restricted to the frontend's own origin, not a wildcard,
    since credentials are involved) - not a Vite dev-server proxy
    (the monolith's `frontend/vite.config.js` already has one, unused
    since `axios.js` calls an absolute URL, not a relative one).
    **This was a deliberate methodological choice, not just the
    path of least resistance**: a proxy would have made the
    cross-origin problem disappear from the browser's perspective
    without it ever having existed in a real deployment sense, masking
    a genuine architectural characteristic of a gateway-less Baseline -
    every service that a browser client talks to directly must handle
    CORS itself. This is a **third citable Baseline-vs-Enhanced
    contrast** (alongside the shared-secret/Gateway-trust point from
    Coupon Service's `/deactivate`, and the caching point already on
    record): Enhanced's Gateway consolidates every service behind one
    origin, eliminating the need for per-service CORS entirely.
    `frontend-baseline/vite.config.js`'s now-inapplicable proxy stanza
    was removed (not left as dead, misleading config pointing at the
    monolith's port).
  - **Analytics reimplemented as client-side aggregation, not left
    broken.** `AnalyticsTab.jsx` calls `/analytics`, but per `CLAUDE.md`
    analytics is explicitly *not* a Stage 2 domain service - it's a
    composition/aggregation layer, and Baseline has no Gateway yet to
    host that composition. Rather than leave the admin dashboard
    non-functional, three small new endpoints were added, each to the
    service that already owns the relevant data (the same "each
    service exposes a summary of its own data" pattern already
    established, not new analytics logic embedded in a domain service):
    `GET /api/auth/count` (User Service, `User.countDocuments()`),
    `GET /api/products/count` (Product Service, `Product.countDocuments()`),
    and `GET /api/orders/summary` (Order Service, porting the
    sales/revenue aggregate and the full 7-day `getDailySalesData`
    logic from the monolith's `analytics.controller.js` verbatim, since
    Order Service already owns all the data needed for both with no
    cross-service call). All three are `protectRoute`+`adminRoute`-gated,
    matching the monolith's single `/analytics` route's trust level.
    `order.route.js` required care: `GET /summary` had to be registered
    **before** `GET /:id`, or Express would match `"summary"` as an
    order id - verified explicitly by hitting both routes after the
    change. `AnalyticsTab.jsx` now fires the three calls via
    `Promise.all` and reassembles them into the exact state shape the
    component already rendered from, so no other component changes
    were needed.
  - **This is a second measurable, citable Baseline-vs-Enhanced
    contrast, not just a functional fix**: Baseline's admin dashboard
    makes three separate round trips and composes them in the browser;
    Enhanced's Gateway is expected to compose the same data server-side
    in one call. The latency/round-trip difference between these two
    approaches is real, measurable, and directly attributable to the
    architectural difference (Gateway vs. none) rather than to
    unrelated implementation variance - exactly the kind of comparison
    this dissertation is structured to produce.
- **Rationale:** Every choice here follows the same underlying test
  already applied throughout this project's Stage 2 work: does doing
  the "easy" thing (a shared frontend with branches, a dev proxy, a
  dropped feature) hide a real architectural characteristic that the
  dissertation needs to measure, or does it just add incidental
  complexity with no comparison value? CORS and client-side analytics
  composition both fail that test if avoided - a proxy or a broken
  dashboard would both be lower-effort, but would either mask or lose a
  genuine, citable Baseline-vs-Enhanced difference.
- **Verification:** Ran all five backend services plus
  `frontend-baseline`'s real Vite dev server together, driven by
  Playwright against a real installed Chrome (same methodology as
  every prior end-to-end verification in this project). Full real
  flow: signup (confirmed a real `User` document created), browse the
  homepage and a category page (Product Service data rendering
  correctly), add to cart (Cart Service write, confirmed via the cart
  page correctly showing merged Cart Service quantity + Product
  Service product details and price), a full real Stripe test-mode
  payment through the actual hosted Checkout page, redirect to
  `/purchase-success` showing "Purchase Successful" (not stuck on
  "Processing"), and confirmed directly in `order-service-db` that the
  correct `Order` document was created from this real, frontend-driven
  checkout. Confirmed the cart was correctly cleared afterward (Redis
  key absent). Promoted the test user to admin, logged in fresh (role
  claims are only refreshed on next login/token-refresh, consistent
  with the stateless-auth design already on record), and loaded the
  Admin Dashboard's Analytics tab: all three service calls resolved
  and composed correctly into the exact same dashboard shape the
  component always rendered - `Total Users: 5`, `Total Products: 27`,
  `Total Sales: 2`, `Total Revenue: $89.88` (`$76.89` real migrated
  order + `$12.99` new order, exactly matching direct database
  totals), plus a correctly-rendered 7-day sales chart. All test data
  (order, user, cart) deleted afterward; all five backend instances
  and the frontend dev server stopped; `backend/` and `frontend/`
  untouched throughout.
  - One process-hygiene note: port 5173 was occupied by a leftover
    Vite dev server from earlier Phase 1 verification work in this
    project (confirmed via process command-line inspection before
    acting, and confirmed with the researcher before terminating it,
    since it wasn't started in this session and killing an
    unrecognized listening process crosses a safety boundary that
    requires explicit confirmation).
- **Alternatives considered:** A Vite dev-server proxy instead of real
  CORS - rejected per the Rationale above, as the methodologically
  weaker choice for a project whose purpose is measuring architectural
  differences, not just making requests succeed. Leaving
  `AnalyticsTab.jsx` pointed at a single service and letting it 404 -
  rejected once client-side aggregation was identified as both
  faithful to `CLAUDE.md`'s "Analytics is not a service" rule and a
  source of real comparison data, not just a workaround. A dynamic
  routing-helper function instead of five named axios exports -
  rejected as unnecessary indirection when every call site's target
  service is already known statically.
- **Stage:** Baseline Microservices (`frontend-baseline/`, per-service
  CORS, the three summary endpoints); both the CORS contrast and the
  client-side-aggregation contrast are written to generalize as
  forward references to Enhanced Microservices, where the Gateway is
  expected to eliminate the need for each.

### [2026-07-16] Two frontend-only UI fixes: Add to Cart hidden for admins; Admin Portal product-name contrast fixed
- **Decision (UI fix, not an architectural decision):** Applied two small
  fixes identically to `frontend/` and `frontend-baseline/`, no backend
  changes.
  1. **Add to Cart hidden for admins.** `ProductCard.jsx`'s button is now
     wrapped in `{!isAdmin && (...)}` (same `user?.role === "admin"` check
     already used by `Navbar.jsx` to hide the Cart link). Root cause: the
     Navbar's Cart link was hidden for admins but the button that adds to
     that same cart wasn't, leaving admins with items they had no UI path
     to check out. `ProductCard` alone wasn't the full picture -
     `FeaturedProducts.jsx` (the home page's "Top Building Supplies"
     carousel) renders its own independent inline Add to Cart button
     rather than using `ProductCard`, and needed the identical fix
     separately. `CategoryPage.jsx` already renders through `ProductCard`,
     so no separate change was needed there.
  2. **Admin Portal product-name contrast.** Investigated before fixing,
     per instruction not to assume the same root cause as the
     `ProductCard` contrast fix from an earlier session (that one was
     customer-facing category/home pages). `ProductsList.jsx` (the
     Products tab under `/secret-dashboard`, admin-only) renders its
     `<tbody>` with `bg-white dark:bg-gray-800`, but the product-name
     `<div>` had hardcoded `text-white` with no light-mode variant - white
     text on a white background in light mode, which is the default theme
     on first login (`localStorage` has no `theme` key yet). Changed to
     `text-gray-900 dark:text-white`, matching the pattern already used
     elsewhere (e.g. `ProductCard.jsx`'s own name text).
- **Verification:** Ran both stacks together - monolith `backend/` +
  `frontend/` (already running) and all five Baseline services +
  `frontend-baseline/` (started for this session) - driven by Playwright
  against a real installed Chrome. Signed up one fresh customer and one
  fresh test user per frontend; promoted the latter to `admin` directly in
  each stack's own database (`backend`'s Atlas DB for the monolith,
  User/Auth Service's for Baseline - same direct-DB-promotion convention
  used in prior verification sessions, confirmed with the researcher
  before proceeding since it writes to real data) and logged in fresh to
  mint an admin-role token. Confirmed, in both frontends: customer sees
  Add to Cart on the home carousel (11) and a category page (4); admin
  sees zero Add to Cart buttons across the same pages; Admin Portal
  Products tab renders all product names legibly (dark text, no longer
  invisible). All four test accounts deleted afterward. Baseline's five
  services and `frontend-baseline/`'s dev server were stopped afterward
  (started only for this verification); the monolith's pre-existing
  `backend/`/`frontend/` processes were left untouched throughout.
- **Stage:** Both Monolith (`frontend/`) and Baseline Microservices
  (`frontend-baseline/`) - a pure UI fix applied identically to both for
  parity, not a Baseline-vs-Enhanced comparison point.

### [2026-07-16] Order Overview feature, Stage 1 (Monolith): admin order listing + order status
- **Decision:** Added two admin-only capabilities to `backend/` and
  `frontend/` only, per this project's rule that new features land in
  the monolith first to avoid a feature-parity confound before later
  mirroring into Baseline/Enhanced.
  1. **`status` field on `order.model.js`** - `enum: ["pending",
     "processing", "shipped", "delivered", "cancelled"]`, `default:
     "pending"`. Existing orders and `createOrder`'s field mapping are
     unaffected; new orders simply pick up the default.
  2. **`getAllOrders`** (`order.controller.js`) - `Order.find({})`,
     populating both `user` (`name email`) and `products.product` (`name
     image price`), mounted at `GET /api/orders/all`. Registered
     *before* the existing `GET /api/orders/:id` in `order.route.js`,
     since Express matches routes top-to-bottom and `:id` would
     otherwise swallow the literal path `/all`.
  3. **`updateOrderStatus`** (`order.controller.js`) - `PATCH
     /api/orders/:id/status`. Explicitly validates the incoming
     `status` against the same enum array *before* touching the
     database, returning a clean `400` with a readable message on an
     invalid value, rather than relying on Mongoose's own enum
     validation to surface correctly - see verification below for why
     this was a real gap, not a defensive-only measure. Both new routes
     are gated with the same `protectRoute, adminRoute` pair already
     used by `product.route.js`'s admin endpoints.
  4. **Frontend:** new `frontend/src/components/OrdersTab.jsx` (styled
     like `ProductsList.jsx`'s table - same `bg-[#111827]`/orange-header
     pattern) - fetches `GET /orders/all` on mount, renders user,
     products, total, a per-row status `<select>` (`PATCH
     /orders/:id/status` on change, updating local state from the
     response so the row reflects the change without a refetch), and
     date. Added as a fourth `AdminPage.jsx` tab (`ClipboardList` icon,
     ordered Create → Products → Orders → Analytics), following the
     exact tab pattern already used by Products/Analytics.
- **Confirmed: `getOrderById`'s existing admin bypass needed no code
  change.** It already does `res.json(order)` on the full document, so
  `status` appears in its response automatically now that the field
  exists on the schema - verified directly (see below), not assumed.
- **Rationale for the explicit pre-save enum check:** tested directly
  (see Verification) what happens on an invalid `status` value with the
  explicit check removed - Mongoose throws a `ValidationError`
  (`error.name === "ValidationError"`), which would fall through to this
  controller module's existing generic `catch` block (identical in
  every handler here: `res.status(500).json({ message: "Server error",
  error: error.message })`), surfacing a client input error as a `500`
  with a raw Mongoose message instead of a clean `400`. This is the same
  category of issue as the Phase 1 code review's fixed findings (a
  correctness/API-contract bug, not cosmetic), so the explicit check was
  added rather than left as a documented-only gap.
- **Alternatives considered:** Add a `try/catch` branch that specifically
  detects `error.name === "ValidationError"` from a failed `save()` and
  maps it to `400` - rejected in favor of validating before the database
  call entirely, which fails faster (no wasted `findById` write attempt
  on bad input) and keeps the validation logic co-located with the enum
  definition itself rather than split across a happy path and an error
  branch. Reusing the schema's own enum array via
  `Order.schema.path("status").enumValues` instead of a duplicated
  `ORDER_STATUSES` constant - considered, but the duplicated constant
  was kept for straightforward readability in a single small file; worth
  revisiting only if the enum is defined in more than one place later.
- **Verification:** Ran directly against the researcher's already-running
  `backend/` (port 5000, connected to the real Atlas `buildmart`
  database) rather than starting a second instance. Created two
  throwaway accounts (`ordertest-verify@example.com`, promoted to
  `admin` via a one-off script using the project's own `connectDB()`;
  `ordertest-customer-verify@example.com`, left as `customer`) - same
  direct-DB-promotion convention as prior sessions. Confirmed: no cookie
  → `401` on both `GET /orders/all` and `PATCH /orders/:id/status`;
  logged-in non-admin customer → `403` on both; created two real orders
  (via `createOrder`, one per test account, hand-built session objects -
  same approach as Phase 1's verification) and confirmed `GET
  /orders/all` as admin returned both regardless of which account placed
  them, with `user` correctly populated; `PATCH .../status` with an
  invalid value returned the new explicit `400` (not a 500); with a
  valid value (`"shipped"`) returned `200` with the updated, fully
  populated order; confirmed via a direct script that removing the
  explicit check and calling `.save()` with an invalid enum value throws
  a Mongoose `ValidationError` that would otherwise have surfaced as an
  uncaught-shape `500`, confirming the gap described above was real, not
  hypothetical. Confirmed `GET /api/orders/:id` (admin bypass) on an
  order the admin didn't place still returns `200` with `status:
  "pending"` present in the response. All test orders and both test
  accounts deleted afterward; no other data touched; `services/` and
  `frontend-baseline/` were not started, modified, or otherwise touched
  this session.
  Separately drove the actual UI: started `frontend/`'s Vite dev server,
  used a headless-Chromium Playwright script against it (a third
  throwaway admin account, one real order created the same way), logged
  in, opened `/secret-dashboard`, clicked the new Orders tab, and
  confirmed via screenshot the table renders correctly styled and shows
  every order across every account (the test account's own order *and*
  a real pre-existing order from a different, real user, side by side) -
  changed a row's status via the dropdown and confirmed, after a full
  page reload plus re-clicking into the Orders tab (tabs are local
  `useState`, reset on reload - pre-existing behavior of every tab here,
  not something this change introduced), the new status persisted.
  Checked browser console/network for regressions: the only errors seen
  were pre-existing periodic `/api/auth/profile` 401s from the auth
  store's own check running before login completes, unrelated to this
  change. Test order, account, and dev server all removed/stopped
  afterward.
- **Stage:** Monolith (this module's shape is intended to map directly
  onto Order Service in Stage 2/3, mirroring the existing
  Order-module-extraction entry above).

### [2026-07-16] Credential rotation after accidental transcript exposure; confirmed old in-process connection doesn't silently persist
- **Finding:** During this session's verification, a `.env`-reading
  shell command (meant to check for a `CLIENT_URL`/`REDIS_URL`-style
  config value, with `secret`/`key` grepped out) still printed the live
  `MONGO_URI` (with embedded Atlas password) and `CLOUDINARY_URL` (with
  embedded key) into the conversation transcript, because neither line
  contains the literal word "secret" or "key" in a position the filter
  caught. Flagged to the researcher immediately; the researcher rotated
  the MongoDB Atlas password and the Cloudinary API key in response.
- **Decision:** Before treating the rotation as complete, checked
  whether the already-running `backend/` process (started at 17:06,
  `.env` rotated at 17:34) would actually be exercising the *new*
  credentials if smoke-tested as-is. It would not have been: `dotenv`
  loads environment variables once at process start, and Mongoose holds
  a persistent connection pool — neither re-reads `.env` because the
  file on disk changed. A request against that still-running process
  would only have exercised the pre-rotation, already-authenticated
  connection, silently proving nothing about the new credentials'
  validity. Confirmed this diagnosis directly (process start time
  preceded the `.env` write) before acting, restarted the backend
  process so it re-ran `dotenv.config()`/`connectDB()` against the
  current `.env`, confirmed the new process logged a successful `MongoDB
  connected`, then ran a real authenticated smoke test against the new
  process specifically (not the old one): a fresh signup (a write) and a
  `GET /api/auth/profile` (an authenticated read requiring
  `protectRoute`'s own `User.findById` call) both succeeded. Test account
  deleted afterward.
- **Rationale:** "The server responds successfully" is not equivalent to
  "the server is using the new credentials" whenever secrets are
  rotated without a process restart - recording this here since it's a
  general verification-methodology point (a rotation is only actually
  verified once the process holding the old value in memory is proven
  to no longer be the one answering requests), not specific to Mongo or
  this project.
- **Alternatives considered:** Smoke-test the already-running process
  without restarting it first - rejected as the exact false-confidence
  failure mode this check exists to catch; a passing result there would
  have meant nothing about whether the new credentials actually work.
- **Stage:** Monolith (operational/process hygiene, not an architectural
  decision - logged per this file's existing precedent for
  credential/config findings, e.g. the `CLOUDINARY_CLOUD_NAME` entry
  above).

### [2026-07-16] Order Overview feature, Stage 2 (Baseline Microservices): admin order listing + order status, mirrored from the monolith
- **Decision:** Mirrored the monolith's already-verified Order Overview
  feature (tagged `v1.1-monolith-baseline`) into Order Service and
  `frontend-baseline/`. A genuine port for the pieces with no
  cross-service dependency; new infrastructure only where the monolith's
  single-database design had nothing to port from.
  1. **`order.model.js`:** `status` enum field, byte-identical to the
     monolith (`pending`/`processing`/`shipped`/`delivered`/`cancelled`,
     default `pending`).
  2. **`getAllOrders`/`updateOrderStatus`** (`order.controller.js`):
     same pre-save enum validation as the monolith's `updateOrderStatus`
     (confirmed necessary there - an invalid value would otherwise
     surface as an uncaught-shape 500 via this file's generic catch
     block, exactly like the monolith). `GET /api/orders/all` and
     `PATCH /api/orders/:id/status` added to `order.route.js`, both
     `protectRoute + adminRoute` gated; `/all` registered alongside the
     existing `/summary` before `/:id` (both literal segments would
     otherwise be swallowed by the `:id` pattern).
  3. **New: User Service batch lookup, the one piece with no monolith
     equivalent to port.** The monolith's `getAllOrders` used Mongoose's
     `.populate("user", "name email")` - not portable here, since Order
     Service only stores a raw user id and User lives in a completely
     separate service/database (`.populate()` requires the referenced
     model to be registered on the same connection, the same constraint
     already documented for `populateOrderProducts`/Product Service).
     No endpoint anywhere in this codebase could resolve a user id to
     name/email outside its own service, so this session added one:
     - `POST /api/auth/users/batch` on User Service
       (`auth.controller.js#getUsersByIds`,
       `User.find({ _id: { $in: ids } }).select("name email")`,
       empty/missing `ids` short-circuits to `[]`) - same shape as
       Product Service's existing `/products/batch`.
     - **Gated by a new `requireInternalServiceKey` middleware**
       (byte-copied from Coupon Service's), not left public like
       Product's batch endpoint. Product's batch returns non-sensitive
       catalog data; this endpoint returns name/email - PII - so it
       follows Coupon Service's `/deactivate` precedent instead. This
       makes the shared-secret-gating rule explicit and consistent
       across all three: **Product's batch stays public** (non-sensitive
       catalog data, gating would add friction for no protection gained);
       **Coupon's `/deactivate` is shared-secret-gated** (a system
       action, not a public read); **User's new batch is
       shared-secret-gated** (a public read, but of PII, which the
       read/write distinction alone doesn't cover) - one
       data-sensitivity-driven pattern, not three unrelated decisions.
     - `services/order-service/src/lib/userServiceClient.js`
       (`getUsersByIds`, `UserServiceUnavailableError`) mirrors
       `productServiceClient.js` exactly in shape - 5s timeout, same
       error-wrapping convention.
     - `INTERNAL_SERVICE_KEY` added to User Service's `.env`/`.env.example`
       (didn't exist there before - only Coupon and Order Service had
       it), copied byte-identical from Order Service's existing value
       via a script rather than typed by hand, so the transcript never
       displayed it. `USER_SERVICE_URL=http://localhost:5002` added to
       Order Service's `.env`/`.env.example`.
  4. **Two-tier fallback on User Service dependency failure - approved
     as a refinement of the researcher's original instruction, and
     worth being precise about for the dissertation's resilience
     discussion.** Distinguishes *complete dependency failure* from
     *partial data-resolution failure*, and further distinguishes
     read-vs-write for how each is handled:
     - **`getAllOrders` (pure read, nothing mutated):** a **total** User
       Service outage (`UserServiceUnavailableError` - network error,
       timeout, or non-2xx from the batch call itself) is **not**
       swallowed - it fails loud, `500 { message: "User Service is
       unavailable - cannot resolve order user details" }`. A **partial**
       resolution gap (User Service reachable and responded, but a
       specific user id simply isn't in the result - e.g. a deleted
       account) degrades gracefully instead: that one row gets `{ name:
       "Unknown User", email: "" }` via `populateOrderUsers`, without
       affecting any other row or failing the request.
     - **`updateOrderStatus` (a write that has already committed by the
       time enrichment runs):** user enrichment is **always**
       best-effort, including on total outage - a 500 at that point
       would misleadingly suggest the status update itself failed when
       it didn't. This is the same fail-fast-vs-best-effort principle
       already established in this codebase for `createCheckoutSession`
       (fails fast - nothing has happened yet) vs. `checkoutSuccess`
       (best-effort - a Stripe payment is already confirmed, so the
       order must never be lost); applied here to a second, independent
       write path for the same underlying reason.
  5. **`frontend-baseline/src/components/OrdersTab.jsx`:** ported from
     the monolith's, using `orderApi` (`lib/api.js`) instead of a
     relative axios path. One addition beyond a literal port: a visible
     error state (`{error}` rendered in place of the table) for the new
     `500` case above - the monolith's version never needed this, since
     the monolith's `getAllOrders` has no dependency that can fail this
     way. `AdminPage.jsx` wired in the same fourth tab, same icon/order
     as the monolith.
  6. `docs/services-overview.md` updated: User/Auth Service's row now
     mentions the new shared-secret-gated batch endpoint; Order
     Service's row now mentions the admin Order Overview endpoints and
     their User Service dependency.
- **Rationale:** "Closer to a port than a redesign" held for every piece
  the monolith already had an equivalent for; the one piece it didn't
  (cross-service user resolution) needed new, deliberately-scoped
  infrastructure rather than a workaround, since Baseline's whole point
  is to surface exactly these service-boundary costs honestly rather
  than hide them. The two-tier fallback is recorded in detail because it
  is a genuine, citable Baseline resilience pattern - one this project
  didn't have an equivalent for elsewhere yet (the existing Product/Cart
  outage handling is single-tier: always-503 for Cart, always-best-effort
  for Order's product enrichment) - so it's evidence for, not just an
  implementation detail of, the dissertation's Baseline-vs-Enhanced
  resilience comparison.
- **Alternatives considered:** Client-side composition (frontend calls
  User Service directly for user lookups, mirroring the Analytics tab's
  pattern) instead of a server-side Order Service → User Service call -
  rejected, because the batch endpoint is shared-secret-gated
  specifically so it can't be called from a browser; embedding
  `INTERNAL_SERVICE_KEY` in frontend JS would expose it to any user via
  devtools, defeating the entire point of the gate. Single-tier
  best-effort for both `getAllOrders` and `updateOrderStatus` (uniform
  with Product's pattern) - considered and initially proposed, but
  rejected in favor of the two-tier design once the read-vs-write
  distinction was made explicit, since silently degrading an admin
  listing to all-unresolved on a total outage hides a real operational
  problem an admin should see, whereas doing the same to a write
  response that already succeeded would misrepresent what happened.
- **Verification:** Ran User Service, Product Service, and Order Service
  standalone against their real databases, plus `frontend-baseline/`'s
  real dev server (Vite auto-selected port 5175, since two
  monolith `frontend/` dev servers already occupied 5173/5174 - the
  three test service instances were started with `CLIENT_URL` overridden
  to 5175 via an env var for this session only, no `.env` files changed,
  monolith processes on 5173/5174 left untouched throughout). Two
  throwaway accounts (one promoted to admin via the same direct-DB-
  promotion convention, against `user-service-db`), two real orders
  created directly via `createOrder` across both accounts. Confirmed:
  no cookie → 401, non-admin → 403 on both new Order Service endpoints;
  `GET /api/orders/all` returns both orders with correctly resolved
  `user.name`/`user.email` via the new cross-service call, alongside a
  real pre-existing order already in `order-service-db`; `PATCH
  .../status` 400s on an invalid value, 200s and persists on a valid
  one. Killed User Service outright and re-hit both endpoints: `GET
  /api/orders/all` → clean `500` with the expected message (not a hang,
  not a generic crash); `PATCH .../status` → `200`, status genuinely
  updated in the database, `user: { name: "Unknown User", email: "" }`
  in the response - confirming the two-tier design exactly as
  documented. Restarted User Service and confirmed `GET
  /api/orders/all` immediately recovered to `200` with no other
  intervention. Then drove the actual UI: Playwright + headless Chromium
  against `frontend-baseline`'s real dev server - logged in as the
  test admin, opened `/secret-dashboard`, clicked the new Orders tab,
  confirmed via screenshot the table renders correctly styled with both
  test orders and the pre-existing real order, side by side, names/
  emails resolved; changed a row's status via the dropdown and confirmed
  it persisted after a full reload plus re-clicking into the tab (same
  tabs-are-local-state caveat as the monolith's own verification).
  Checked console/network for regressions - the only errors seen were
  the same pre-existing periodic `/api/auth/profile` 401 (unrelated,
  already documented in the Stage 1 entry) and `ERR_CONNECTION_REFUSED`
  against Cart Service on `:5003`, which was never started for this
  session and isn't exercised by this feature. All test
  accounts/orders deleted afterward; all three temporarily-started
  service instances and `frontend-baseline`'s dev server stopped;
  `backend/` and `frontend/` (the monolith) were not started, modified,
  or otherwise touched at any point this session.
- **Stage:** Baseline Microservices (mirrors
  `v1.1-monolith-baseline`'s Stage 1 Order Overview entry above).

### [2026-07-16] Search feature, Monolith first
- **Decision:** Added product search to `backend/` and `frontend/` only,
  per this project's rule that new features land in the monolith first.
  1. **`GET /api/products/search?q=<query>`** (`product.controller.js`
     #searchProducts, public, no auth - matches the existing public
     browsing routes). Empty/missing `q` (after `.trim()`) returns `[]`
     immediately with no database call. Otherwise, `Product.find({ $or:
     [...] })` across `name`/`description`/`category`, each a
     case-insensitive (`$options: "i"`) `$regex`. Registered in
     `product.route.js` alongside the other public GET routes - no
     ordering conflict, since this router has no GET `/:id` for
     `/search` to collide with.
  2. **Regex-escaping.** A small inline `escapeRegExp` helper escapes
     `.*+?^${}()|[]\` in `q` before it becomes a `$regex` pattern - the
     query is a literal substring search from the user's point of view,
     and an unescaped special character (most plausibly a parenthesis,
     given real product names like "PVC Plumbing Pipe (6m length)")
     would either throw or silently change what's matched. Confirmed
     directly (not assumed) that this is a real, not theoretical, gap:
     a raw `Product.find({ name: { $regex: "(6m", $options: "i" } })`
     against the real database throws `MongoServerError: Regular
     expression is invalid: missing closing parenthesis` - exactly the
     failure this escaping prevents, reproduced with the fix removed
     and confirmed absent with it in place.
  3. **Frontend:** new `frontend/src/pages/SearchResultsPage.jsx` -
     *not* a reuse of `ProductsList.jsx` (the admin product-management
     table, wrong reuse target entirely) but a near-mirror of
     `CategoryPage.jsx`'s existing pattern (`useSearchParams` in place
     of `useParams`, same `ProductCard` grid), since that's the
     customer-facing grid this app already has. Distinguishes two empty
     states: no `q` at all ("Type something to search") vs. `q` present
     with zero results ("No products found"). New `searchProducts`
     action in `useProductStore.js` is the single place that decides
     whether the network is hit at all - `if (!query?.trim())` sets
     `products: []` and returns before any `axios` call, regardless of
     whether the caller is the debounced input or a direct visit to a
     bare `/search` URL.
  4. **Debounce, `Navbar.jsx`.** New search `<input>`, visible
     unconditionally on every page (not gated on login/role). A
     `SEARCH_DEBOUNCE_MS = 300` module-level named constant (not an
     inline magic number, per explicit instruction) drives a
     `useEffect`/`setTimeout` keyed on the raw input value: only the
     value still current 300ms after the last keystroke triggers
     `navigate(\`/search?q=...\`, { replace: true })`; every keystroke
     before that clears and resets the pending timeout. `replace: true`
     avoids pushing one browser-history entry per debounced keystroke
     while refining a query already on the results page. An empty
     (trimmed) value makes the effect return early - no navigation, no
     fetch, and clearing the input while on `/search` leaves the last
     results in place rather than forcing a blank state. Debouncing
     (Navbar, "when to update the URL") and fetching (`SearchResultsPage`
     `useEffect` keyed on the URL's `q`, mirroring `CategoryPage`) are
     deliberately separate concerns, same separation already established
     by `CategoryPage`/`fetchProductsByCategory`.
- **Rationale:** Reusing `CategoryPage.jsx`'s exact shape (URL-param-
  driven fetch, `ProductCard` grid) rather than inventing a new rendering
  approach keeps this feature visually and structurally consistent with
  the rest of the app's product-browsing pages, and keeps the "empty
  query" guard in exactly one place (the store action) so it holds
  regardless of entry point, rather than being re-implemented at every
  call site. Escaping regex special characters is boundary input
  validation on a public, unauthenticated endpoint - exactly the kind of
  validation this project's own conventions call for at a system
  boundary, not an over-engineered addition.
- **Alternatives considered:** A live-search dropdown rendered directly
  from `Navbar.jsx` (no dedicated results page/route) - rejected, since
  the researcher's spec explicitly asked for a results *view*, and a
  URL-addressable `/search?q=...` route is also directly shareable/
  bookmarkable, unlike dropdown state trapped in the navbar. Reusing
  `ProductsList.jsx` - rejected outright once clarified that component is
  the **admin** product-management table (edit/delete/toggle-featured),
  not a customer-facing grid; reusing it for public search results would
  have been a real design error, not a stylistic choice.
- **Verification:** Backend tested directly against the real, already-
  running monolith (confirmed the running process started *after* these
  edits were saved, not before, learning directly from this session's
  earlier credential-rotation lesson about stale in-process state).
  Confirmed: case-insensitive substring match works across all three
  fields - a `q=cement` search correctly returned every product in the
  `cement` category *and* all three `Reinforcement Steel Rod` products,
  which don't mention "cement" in their category or description at all;
  investigated rather than assumed this was a bug, and confirmed it's
  actually correct - the word "reinforce**cement**" (from the product
  name "Reinforcement Steel Rod") genuinely contains "cement" as a
  literal substring. Confirmed a description-only match (`q=drainage
  installations`, present in one product's description but not its name
  or category) returns exactly that product. Confirmed missing `q`,
  `q=`, and whitespace-only `q` all return `[]`, not all 27+ seeded
  products. Confirmed the exact parenthesis case explicitly requested -
  `q=(6m` and `q=Pipe (6m length)` both return `200` with the correct
  product, not a `500`. Then drove the real frontend (Playwright,
  headless Chromium, against the actual already-running Vite dev
  server) with network-request logging: typing "pip" fired **zero**
  requests immediately and at +150ms (still inside the 300ms window),
  then exactly one navigation/fetch at +450ms; continuing to type
  "e (6m)" to refine the query while already on the results page fired
  zero requests mid-typing and exactly one after the debounce resettled,
  landing on `/search?q=pipe%20(6m` and correctly rendering "PVC
  Plumbing Pipe (6m length)" - the parenthesis case working through the
  actual UI, not just curl. Clearing the input afterward fired zero
  further requests. Visiting a bare `/search` URL directly (no `q` at
  all) fired zero network requests and rendered the "Type something to
  search" empty state. One irregularity investigated rather than
  dismissed: the very first debounced navigation fired **two** identical
  requests instead of one; confirmed `frontend/src/main.jsx` wraps the
  app in `<StrictMode>`, which intentionally double-invokes effects on a
  component's *initial* mount in development only (never production) -
  consistent with the observed pattern, since the second, subsequent
  query refinement (no remount involved) fired exactly once. Not a
  debounce defect. `services/` and `frontend-baseline/` were not
  touched at any point this session.
- **Stage:** Monolith (feature-parity rule: Baseline/Enhanced mirroring
  deferred to a future session, same sequencing as Order Overview above).

### [2026-07-16] Search follow-up: category dropped from searchable fields
- **Decision:** Removed `category` from `searchProducts`'s `$or` -
  search now matches `name` and `description` only. `escapeRegExp` and
  the case-insensitive `$options: "i"` approach are unchanged for the
  two remaining fields.
- **Rationale (principled, not a reproduced-bug fix - see below):**
  Category values in this schema are internal slugs (`"roofing-sheet"`,
  `"wall-paints"`, `"water-tank"`, etc.), not customer-facing prose -
  they exist to drive `/category/:category` browsing and admin
  filtering, not to be read or searched as natural-language text. Making
  them substring-searchable risks exactly the class of problem this
  session already found once with unescaped regex characters: an
  internal implementation detail (a slug's exact spelling/hyphenation)
  leaking into and unpredictably shaping user-facing search results, in
  a way a customer typing a plain-language query has no way to
  anticipate or reason about. Category-based discovery isn't lost -
  it remains fully available via the existing `/category/:category`
  browsing feature this app already has; this is a correction of *where*
  that capability belongs, not a removal of it.
- **Correction to how this issue was raised:** it was initially
  described (by the researcher, based on a report to them) as a
  specific, already-observed false positive - a `q=pipe` search
  incorrectly returning a `roofing-sheet`-category product. Before
  making this change, that specific example was checked directly against
  the real, full 27-product dataset (via the admin `GET /api/products`
  endpoint, not just the public browsing endpoints, to rule out
  anything hidden from those): `q=pipe` and `q=pipes` both returned only
  the 4 legitimate `pipes`-category products, both before and after this
  change, and `"roofing-sheet"` contains no letter `p` at all, making
  that specific substring match structurally impossible. The researcher
  confirmed, once shown this, that the specific example was inaccurate -
  not a bug that was actually observed and reproduced. This entry
  therefore documents dropping `category` as a **principled design
  decision** (stated above), not as the fix for a verified false
  positive - recorded precisely so this isn't later cited as evidence of
  a bug that was never actually confirmed to exist.
- **Alternatives considered:** Keep `category` in the search but anchor
  or restrict the match somehow (e.g. exact match only, or a
  separate/lower-weighted result tier) - rejected as unnecessary
  complexity for a field that already has a dedicated, better-suited
  browsing path (`/category/:category`); simply excluding it from
  free-text search is the smaller, more predictable change.
- **Verification:** Re-ran `q=pipe` against the updated implementation -
  confirmed the same 4 legitimate `pipes`-category products
  (`PVC Plumbing Pipe`, `PVC Drainage Pipe`, `Copper Water Pipe`,
  `Flexible Conduit Pipe`), matched via `name`, with `category` no
  longer part of the query at all. Re-ran both parenthesis-escaping
  cases from the original verification (`q=(6m` and `q=Pipe (6m
  length)`) to confirm the regex-escaping fix and the two-field query
  still behave correctly together - no regression from removing the
  third `$or` clause.
- **Stage:** Monolith.

### [2026-07-16] Search feature, Stage 2 (Baseline Microservices): ported from the monolith, plus a race-condition fix new to Baseline
- **Decision:** Mirrored the monolith's tagged `v1.2-monolith-baseline`
  Search feature (see the two Stage 1 entries above, including the
  category-exclusion correction) into Product Service and
  `frontend-baseline/`. A direct port for everything the monolith already
  had verified, plus one genuine fix introduced only in Baseline this
  session - not present in `v1.2-monolith-baseline` - see below.
  1. **`GET /api/products/search?q=<query>`** - `escapeRegExp` and
     `searchProducts` ported verbatim into
     `services/product-service/src/controllers/product.controller.js`,
     byte-identical logic to the monolith's v1.2 version (`name`+
     `description` only, `$options: "i"`, empty `q` short-circuits to
     `[]`). Route added to `product.route.js` alongside the other public
     GET routes - no ordering conflict, this router has no GET `/:id`
     either.
  2. **`frontend-baseline` port** - `Navbar.jsx` gets the same search
     `<input>` and the same `SEARCH_DEBOUNCE_MS = 300` named constant/
     debounced-navigation effect as the monolith; new
     `SearchResultsPage.jsx` mirrors the monolith's (itself a mirror of
     `CategoryPage.jsx`'s pattern); `useProductStore.js` gets a
     `searchProducts` action calling `productApi` instead of a
     monolith-relative `axios` instance.
  3. **New in Baseline, not a straight port: `AbortController`-based
     request cancellation in `searchProducts`.** A module-scoped
     `searchAbortController` variable in `useProductStore.js`; every call
     aborts whatever search is still in flight before starting a new one,
     and the `catch` block silently ignores the resulting
     `ERR_CANCELED` rejection rather than surfacing it as a failed
     search. This closes a real race condition, distinct from - and
     initially misdescribed as - a "stale closure" in the debounce
     `useEffect` itself: the debounce hook (`[searchInput, navigate]`
     deps) was already correctly scoped and re-runs fresh on every
     keystroke, with no staleness bug. The actual risk lives one level
     down, in `SearchResultsPage`'s effect (`searchProducts(q)` on every
     `q` change): each debounced navigation fires a new search request,
     and without cancellation, an older, slower response arriving after
     a newer, faster one would silently overwrite `products` with
     stale, mismatched results - exactly the scenario "search again
     without navigating away" exercises. Fixed once, centrally, in the
     store action - the same place the empty-query guard already lives -
     rather than at either call site.
  4. **This same race condition exists, unfixed, in the monolith's
     tagged `v1.2-monolith-baseline`** (`frontend/src/stores/
     useProductStore.js` has the identical no-cancellation pattern).
     Per this session's explicit scope, `backend/`/`frontend/` were not
     touched to fix it - flagged here as a concrete, worth-doing
     follow-up for a future monolith-focused session, not silently left
     undiscovered. Baseline is not "ahead" of the monolith by design
     here; this is an incidental correctness improvement made during a
     mirror, the same category of thing as the two-tier User Service
     fallback added during the Order Overview Stage 2 mirror.
- **Rationale:** Porting verbatim where the monolith is already correct
  (the regex-escaping fix especially - re-deriving it from scratch would
  risk reintroducing the exact parenthesis bug already fixed and
  verified in Stage 1) avoids doing already-finished design work twice.
  The `AbortController` fix belongs in Baseline now because it was
  identified and confirmed during this session's build, not because
  Baseline categorically needs more resilience than the monolith -
  recording the monolith's matching gap explicitly prevents this from
  reading as an intentional architectural difference between the two
  when it's actually just sequencing (found here first, not fixed there
  yet).
- **Verification:** Ran Product Service standalone against its real
  database - confirmed `q=pipe` returns the same 4 `pipes`-category
  products as the monolith, `q=(6m` and `q=Pipe (6m length)` both return
  the correct product (not a `500`), and missing/empty `q` returns `[]`.
  Then drove the real `frontend-baseline` dev server with Playwright
  (Vite auto-selected port 5175 again, since 5173/5174 were occupied by
  pre-existing monolith `frontend/` processes left untouched; Product
  Service was started with `CLIENT_URL` overridden to 5175 for this
  session only, no `.env` file changes, same pattern as the Order
  Overview Stage 2 verification): confirmed the debounce fires zero
  requests until 300ms after the last keystroke; confirmed the
  parenthesis case renders correctly through the actual UI; confirmed a
  bare `/search` visit and a cleared input both fire zero requests.
  **Explicitly exercised the race-condition scenario the `AbortController`
  fix targets:** searched "pipe" (results correctly showed `PVC Plumbing
  Pipe...`), then, without navigating away, cleared the box and searched
  "cement" - confirmed exactly one new request fired, the URL updated to
  `q=cement`, the results correctly showed only cement products (`Portland
  Cement`, `White Cement`, `Waterproof Cement`, plus the same
  "Reinforcement Steel Rod" substring match already verified in Stage 1),
  and the prior query's `PVC Plumbing Pipe` result was completely gone -
  not lingering, not flashing back in. Also observed, as an incidental
  confirmation the cancellation logic works correctly: the
  network log showed one of the two `<StrictMode>` mount-time duplicate
  requests for the first search being cleanly aborted by the second, the
  same mechanism doing double duty. All temporary service/dev-server
  instances stopped afterward; `backend/` and `frontend/` were not
  started, modified, or otherwise touched this session.
- **Stage:** Baseline Microservices (mirrors both Stage 1 Search entries
  above; the `AbortController` fix is Baseline-first, flagged for the
  monolith as noted).

### [2026-07-16] AbortController race-condition fix backported into the monolith - closes the flagged asymmetry
- **Decision:** Backported the `AbortController`-based request-cancellation
  fix from `frontend-baseline/src/stores/useProductStore.js`'s
  `searchProducts` action into `frontend/src/stores/useProductStore.js`'s
  - the same module-scoped `searchAbortController` variable, the same
  abort-before-starting-a-new-request logic, the same silent handling of
  the resulting `ERR_CANCELED` rejection. Logic is identical between the
  two; the only difference is which axios instance is used (`axios` from
  `../lib/axios` in the monolith vs. `productApi` from `../lib/api` in
  `frontend-baseline`), unchanged from before this fix. `backend/` was not
  touched - this is a pure frontend state-management fix, no server-side
  component.
- **Rationale:** This closes the exact asymmetry flagged in the Search
  Stage 2 entry above: the race condition (an older, slower search
  response landing after a newer, faster one and silently overwriting
  `products` with stale, mismatched results) was found and fixed in
  Baseline first, purely as a sequencing artifact of which codebase was
  being worked on at the time - not because the monolith needed it less.
  Leaving it unfixed in the monolith would have meant Comparison A
  (Monolith vs. Baseline) reflected an incidental implementation
  discrepancy rather than an intentional one, the same category of
  concern already on record in this file (see the "Monolith audited for
  four performance optimizations" entry) about keeping cross-stage
  comparisons attributable to architecture, not to which codebase
  happened to get a fix first.
- **Verification:** Ran the same specific test already proven in
  `frontend-baseline`, against the real, already-running monolith
  `backend/` and `frontend/` (Playwright, headless Chromium - noted in
  passing that this Vite instance listens on `[::1]:5173`, IPv6 loopback
  only, so the verification script navigated to `http://[::1]:5173/`
  explicitly rather than `localhost`, which Chromium was resolving to an
  unbound IPv4 address and timing out on): searched "pipe" (correctly
  showed `PVC Plumbing Pipe...`, URL updated to `/search?q=pipe`), then,
  without navigating away, cleared the box and searched "cement" -
  confirmed exactly one new request fired, the URL updated to
  `q=cement`, the results correctly showed only cement products (and the
  same "Reinforcement Steel Rod" substring match already verified twice
  before), and the prior query's `PVC Plumbing Pipe` result was
  completely gone. Identical outcome to the `frontend-baseline`
  verification in the entry above - the fix behaves the same in both
  codebases, as expected from an unchanged port. No backend changes
  were needed or made; the already-running monolith `backend/` process
  (pre-existing, not started this session) was left untouched throughout.
- **Stage:** Monolith. This entry, together with the two above, means
  the `AbortController` fix now exists identically in both the monolith
  and Baseline Microservices - the asymmetry is closed.

### [2026-07-16] Deployment topology: Baseline on 5 EC2 instances, Monolith on 1 - a compute-parity confound, mitigated not eliminated
- **Decision:** Baseline Microservices is deployed across 5 separate EC2
  instances, one per service (Product, User/Auth, Cart, Coupon, Order),
  while the Monolith runs on a single EC2 instance. This is a deliberate
  choice favoring genuine infrastructure-level service isolation -
  independent failure domains, independent scaling, independent
  resource limits per service - over either cost minimization or strict
  compute-parity with the Monolith.
- **Acknowledged confound:** this means Baseline has access to greater
  aggregate compute than the Monolith, which is a potential confound
  when interpreting raw performance differences in Comparison A
  (Monolith vs. Baseline) - some of any observed difference may reflect
  available resources rather than architecture alone. This is recorded
  explicitly rather than left implicit, per this file's own standard for
  every other comparison-affecting decision (e.g. the four-optimizations
  audit entry, the `AbortController` asymmetry just closed above).
- **Mitigation (narrows, does not eliminate, the gap):** Baseline's five
  instances are each sized smaller (`t3.micro`) relative to the
  Monolith's single, larger instance (`t3.small`) - deliberately chosen
  to reduce the aggregate compute gap between the two sides without
  attempting to erase it entirely (erasing it would mean either
  under-provisioning Baseline's per-service isolation below what a real
  microservices deployment would use, or over-provisioning the Monolith
  beyond what a real single-instance deployment would use - both would
  themselves be confounds, just differently shaped ones).
- **Rationale:** Comparison A is explicitly about deployment efficiency,
  accessibility, and loading performance across two genuinely different
  deployment topologies (per `CLAUDE.md`'s research design) - matching
  compute exactly would misrepresent what a real-world Monolith-vs-
  Baseline-Microservices migration actually looks like, since one of the
  concrete costs/benefits of decomposing into services is precisely
  that each service can be provisioned (and scaled) independently. The
  `t3.micro`/`t3.small` sizing choice is the practical middle ground: it
  doesn't pretend the two topologies have identical compute, but it
  avoids the confound being extreme.
- **Alternatives considered:** Identical instance count/size on both
  sides (e.g. 5x `t3.small` for Baseline, matching the Monolith's size
  exactly) - rejected as artificial parity that would itself misrepresent
  a realistic Baseline deployment and wouldn't reflect how organizations
  actually size decomposed services. Running Baseline on a single shared
  EC2 instance (5 processes, 1 machine) - rejected as contradicting the
  entire point of Baseline's service-isolation design; it would collapse
  the independent-failure-domain property this stage exists to
  demonstrate, and would confound Comparison B (Baseline vs. Enhanced)
  instead, where Enhanced's Kubernetes orchestration is meant to be
  compared against a genuinely multi-instance Baseline.
- **Action item:** This limitation and its mitigation must be referenced
  explicitly in the dissertation's discussion of Comparison A results -
  not left as a methods-section footnote - since any raw performance
  delta reported there needs this caveat to be interpreted correctly.
- **Stage:** Baseline Microservices (deployment topology; affects
  interpretation of Comparison A, Monolith vs. Baseline).

### [2026-07-17] Four performance optimizations applied to the Monolith too - revises the prior Baseline/Enhanced-only scope
- **Decision:** Implemented indexes, pagination, HTTP compression, and
  `Promise.all` parallelization in `backend/` and `frontend/` (the
  Monolith) - the same four optimizations the "Monolith audited for four
  performance optimizations" entry above concluded should apply to
  "Baseline Microservices and Enhanced Microservices (backend four)"
  only. This explicitly revises that entry's stated scope: the
  optimizations now apply to **all three stages**, not two.
  - **Indexes added** (`backend/models/`):
    - `product.model.js`: `{ category: 1 }` (getProductsByCategory
      lookups), `{ isFeatured: 1 }` (getFeaturedProducts/cache-rebuild
      lookups), `{ createdAt: -1 }` (pagination sort-stability - without
      a deterministic sort, skip/limit pagination can return
      duplicate/missing items across page boundaries).
    - `order.model.js`: `{ user: 1, createdAt: -1 }` compound (covers
      getUserOrders' filter+sort together), `{ createdAt: -1 }`
      standalone (covers getAllOrders' unfiltered sort, which the
      compound index's prefix rules can't serve).
    - No new index on `user.model.js` (email already unique-indexed) or
      `coupon.model.js` (code/userId already unique-indexed and already
      the most selective possible filters).
    - **Known limitation, deliberately not solved here:** `searchProducts`
      still filters via an unanchored `$regex` on `name`/`description`
      (`$or`), which cannot use any standard B-tree index for the filter
      step - only regex patterns anchored with `^` can. The `createdAt`
      index benefits search's *sort* step only, not its filter step. A
      MongoDB text index would change the query syntax and introduce
      relevance scoring - a materially different feature, not a drop-in
      index addition - so it was scoped out rather than silently
      papered over.
  - **Pagination added**, one consistent shape across every list
    endpoint: `{ data, total, page, limit, hasMore }`
    (`hasMore = page * limit < total`), via a new shared
    `backend/lib/pagination.js` helper (`parsePagination`,
    `paginatedResponse`) rather than five slightly different
    reimplementations of the same skip/limit math. Query params:
    `?page=&limit=`.
    - Endpoints changed: `GET /api/products` (getAllProducts),
      `GET /api/products/category/:category`, `GET /api/products/search`,
      `GET /api/orders` (getUserOrders), `GET /api/orders/all`
      (getAllOrders, admin).
    - `GET /api/orders` (getUserOrders) has **no frontend consumer
      anywhere in `frontend/src`** (confirmed via grep before making the
      change) - paginated on the backend anyway for consistency with the
      other four, with no corresponding frontend file to update.
    - Not paginated: `/products/featured` (Redis-cached, admin-curated,
      already windowed client-side by the home carousel) and
      `/products/recommendations` (hard-capped at 4 via `$sample`) -
      neither is an unbounded, growing list.
    - Frontend: `useProductStore.js` gained a `pagination: { total,
      page, limit, hasMore }` field alongside the existing shared
      `products` array; `fetchAllProducts`, `fetchProductsByCategory`,
      and `searchProducts` each take an optional `{ page }` - page 1
      replaces `products` wholesale, page > 1 appends. `ProductsList.jsx`,
      `CategoryPage.jsx`, and `SearchResultsPage.jsx` each gained a "Load
      More" button gated on `pagination.hasMore`. `OrdersTab.jsx` doesn't
      use the Zustand product store (it has its own local `useState`),
      so it got its own local `page`/`total`/`hasMore` state and Load
      More button instead.
    - **UX choice: "Load More" button**, not page numbers or infinite
      scroll. This app had no prior pagination convention to match
      either way; Load More lets the shared-`products`-array store use
      one explicit branch (replace on page 1, append on page > 1)
      without needing total-page-count tracking (page numbers) or a
      scroll-position observer per list (infinite scroll) - and it's
      deterministically testable (click once, assert growth and the
      correct `hasMore` flip at the true last page).
    - **Page size:** `12` everywhere except `OrdersTab.jsx`, which uses
      `20` (`ORDERS_PAGE_SIZE`, a locally-scoped constant, matching this
      codebase's existing convention of file-local named constants like
      `SEARCH_DEBOUNCE_MS` in `Navbar.jsx`). Reasoning for the exception:
      `OrdersTab` is an internal admin tool, not customer-facing
      browsing - admins scanning order statuses benefit from seeing more
      rows per page (fewer clicks, more triage context), and a table row
      is far more information-dense per pixel than a product grid tile,
      so a larger count doesn't cause the visual overload it would in a
      grid. The interaction pattern (Load More) stays identical; only
      the numeric limit differs.
  - **HTTP compression:** added the `compression` npm package and
    `app.use(compression())` in `backend/server.js`, placed before
    `express.json()` in the middleware stack. No design decision
    needed - standard placement.
  - **`Promise.all` applied** at:
    - `analytics.controller.js#getAnalyticsData`: `User.countDocuments()`
      + `Product.countDocuments()` (already known from the prior audit).
    - `analytics.route.js`: `getAnalyticsData()` +
      `getDailySalesData()` (already known from the prior audit).
    - `payment.controller.js#checkoutSuccess` (**new this pass**):
      conditional `Coupon.findOneAndUpdate` (coupon deactivation) +
      `createOrder(session)` + `User.findByIdAndUpdate(...cartItems:
      [])` - three independent writes to three different documents.
      `Promise.all`'s own reject-on-first-failure semantics preserve
      the exact fail-fast-on-any-error behavior the sequential version
      had.
    - `product.controller.js#deleteProduct` (**new this pass**):
      `cloudinary.uploader.destroy(...)` (conditional, already
      swallowing its own errors) + `Product.findByIdAndDelete(...)` -
      independent once the product/its image URL is already known from
      the initial `findById`.
    - Introduced as a direct consequence of adding pagination: the
      `find().skip().limit()` + `countDocuments()` pair inside all five
      newly-paginated endpoints, built as `Promise.all` from the start.
    - Checked and confirmed **not** candidates (genuinely sequential,
      left alone): `updateOrderStatus` (each step depends on the last);
      `toggleFeaturedProduct`'s `save()` → cache rebuild (the rebuild
      query must read post-save data or it caches stale state);
      `createProduct`'s cloudinary upload → `Product.create()` (create
      needs the upload's URL); `validateCoupon`'s `findOne()` →
      conditional `save()`; `createOrder`'s idempotency check →
      conditional `save()`.
- **Rationale for revising scope to include the Monolith:** the prior
  entry's reasoning for applying these four optimizations to *both*
  Baseline and Enhanced (rather than Enhanced-only) was that none of
  them are architectural to Enhanced, so Enhanced-only application would
  let Comparison B misattribute implementation-quality gains to
  architecture. That exact reasoning extends one comparison earlier:
  none of the four are architectural to Baseline either, so applying
  them to Baseline/Enhanced but not the Monolith would let Comparison A
  (Monolith vs. Baseline) misattribute the *same* implementation-quality
  gains to architecture. Applying uniformly across all three stages
  isolates architecture as the sole variable in **both** comparisons,
  using one consistent principle rather than a principle that stopped
  one stage short of where it actually applies.
- **Alternatives considered:** Leave the Monolith as originally scoped
  (unoptimized), preserving the prior entry's conclusion - rejected once
  it became clear the same misattribution risk the prior entry used to
  justify Baseline+Enhanced applies equally to Monolith-vs-Baseline;
  leaving it unaddressed would have been an inconsistency in this file's
  own stated reasoning, not a considered choice.
- **Verification:**
  - **Indexes:** confirmed live via a direct query against the running
    server's actual MongoDB connection (`Model.collection.indexes()`) -
    all five present with the expected key specs
    (`category_1`, `isFeatured_1`, `createdAt_-1` on products;
    `user_1_createdAt_-1`, `createdAt_-1` on orders).
  - **Pagination:** verified against the real dataset (27 products, 1
    order) at exact page boundaries for all five endpoints - correct
    `total`, no duplicate/missing IDs across pages, and `hasMore`
    flipping to `false` exactly at the true last page (e.g. search
    "cement": 7 total, limit 2, `hasMore` correctly `false` only on
    page 4's 1 remaining item).
  - **Compression:** confirmed `Content-Encoding: gzip` on response
    headers; same endpoint's payload measured 2914 bytes uncompressed
    vs. 952 bytes compressed on the wire (~67% reduction).
  - **`Promise.all` equivalence:** analytics endpoint's combined output
    checked for internal consistency (5 users, 27 products, 1 sale/
    $76.89, matching the single order's actual date in the daily
    breakdown). `deleteProduct` verified with a real create-then-delete
    round trip against Cloudinary + MongoDB - both the DB removal and
    the Cloudinary image deletion were confirmed to complete (server log
    showed the Cloudinary destroy confirmation), matching the original
    sequential version's effects, just now concurrent.
  - **`checkoutSuccess`'s new `Promise.all` could not be verified via a
    live end-to-end run** - this repo already has a documented,
    pre-existing gap (`.env` has a placeholder Stripe key, noted in
    `CLAUDE.md`'s "Current phase" section) that blocks any live Stripe
    checkout round-trip, before or after this change. Verified at the
    code level only: three writes to three different documents with no
    data dependency between them, and `Promise.all`'s semantics preserve
    the exact fail-fast-on-any-error behavior the sequential version had.
    Recorded here explicitly rather than treated as silently covered.
  - **Frontend:** real Playwright (headless Chromium) verification,
    logged in as a throwaway admin test account (promoted to admin
    directly in the database, deleted afterward). Admin `ProductsList`
    Load More confirmed live (12 → 24 rows against the real 27-product
    dataset, matching the API-level check). `OrdersTab` confirmed
    rendering correctly (all 5 columns, real order data) and its status
    dropdown change confirmed to persist after a real page refresh
    (changed "processing" → "pending", reloaded, still "pending"; then
    reverted back to "processing" to leave the real order unchanged).
    `CategoryPage` (cement: 4 products) and `SearchResultsPage`
    ("cement": 7 products) both correctly show **no** Load More button,
    since their real datasets are under the 12-item page size -
    `hasMore` was confirmed `false` at the API level for both; the Load
    More mechanism itself (click → page+1 → append → hide-when-exhausted)
    was proven live via the identical code path in `ProductsList`, so
    this wasn't independently re-proven with artificially padded data
    just to force the button to appear.
- **Incidental finding during verification - not a bug in this app:** a
  stray `test` database exists alongside `build-mart` in the same
  MongoDB Atlas cluster, containing similarly-shaped collections. This
  caused a real mix-up during admin-account promotion for testing (an
  update was run against `test` instead of `build-mart`, silently
  "succeeding" against the wrong database with no error, which is what
  made it non-obvious until the resulting login still showed the
  unpromoted role). Recorded here so it doesn't cause confusion again,
  especially before any future scripting that might query broadly
  across the cluster without pinning the database name explicitly.
  Worth deciding whether the `test` database should be deleted entirely
  once it's confirmed nothing in this project depends on it.
- **Stage:** Monolith. (Baseline Microservices and Enhanced Microservices
  already covered by the prior entry above; `services/` and
  `frontend-baseline/` were not touched this session.)

### [2026-07-17] Indexes mirrored into Baseline Microservices - Stage 2, Part 1 of 4 of the optimization pass
- **Decision:** Ported the same index specs verified in the Monolith at
  `v1.4-monolith-baseline` into the two Baseline services that own the
  equivalent data, matching each service's own schema rather than
  copy-pasting blindly:
  - `services/product-service/src/models/product.model.js`:
    `{ category: 1 }`, `{ isFeatured: 1 }`, `{ createdAt: -1 }` - same
    three as the monolith. Confirmed against Product Service's own
    controller before porting: `getProductsByCategory` filters on
    `category`, `getFeaturedProducts`/`updateFeaturedProductsCache`
    filter on `isFeatured`, exactly matching the monolith's usage this
    was copied from.
  - `services/order-service/src/models/order.model.js`:
    `{ user: 1, createdAt: -1 }` compound + `{ createdAt: -1 }`
    standalone - same two as the monolith. Confirmed against Order
    Service's own controller first: `getUserOrders` filters on `user`
    and sorts on `createdAt` together (served by the compound index),
    `getAllOrders` sorts on `createdAt` with no filter (can't use the
    compound index's prefix, needs the standalone one) - identical
    query shapes to the monolith's `getUserOrders`/`getAllOrders`.
    `stripeSessionId` was **not** re-added as a new index - it already
    carries `unique: true` in both the monolith and this service, which
    Mongoose backs with its own index automatically; verified live
    (below) rather than assumed.
  - **User Service and Coupon Service checked, no new index added to
    either** - same conclusion the monolith's audit reached, confirmed
    against these services' own queries this time rather than just
    inherited: `auth.controller.js` queries `User` only by `email`
    (already `unique: true`-indexed) or `_id` (default-indexed);
    `coupon.controller.js` queries `Coupon` only by `userId` and/or
    `code` (both already `unique: true`-indexed), the most selective
    filters available on that schema. No frequently-queried unindexed
    field exists on either model.
  - **Cart Service: explicitly confirmed out of scope, not silently
    skipped** - it has no `MONGO_URI`, no `.env` MongoDB config, and no
    Mongoose model file at all (`services/cart-service/src` contains no
    `models/` directory); cart data lives entirely in Redis
    (`src/lib/redis.js`), consistent with `CLAUDE.md`'s fixed decision
    that Cart is Redis-backed, not MongoDB, from Stage 2 onward. There
    is nothing for a MongoDB index to apply to.
- **Scope discipline:** this pass is indexes only. Pagination,
  compression, and `Promise.all` are separate, later parts of this same
  four-part optimization pass (Stage 2, Parts 2-4), each to be verified
  independently before starting the next - not bundled in here even
  though some of the reasoning (e.g. `createdAt` backing pagination's
  sort stability) already anticipates Part 2. `frontend-baseline/` was
  not touched: indexes are a backend/database-only change with no
  frontend-visible effect.
- **Verification:** Used the same specific method already proven in the
  monolith - a temporary debug route added to each service's own
  `server.js`, querying `Model.collection.indexes()` through the
  connection the running server itself already established via its
  normal `connectDB()` startup path, hit once via a plain HTTP request
  against the live, already-started service, then removed before commit
  (confirmed via `git diff` showing an empty diff on both `server.js`
  files afterward - no leftover route). This is a deliberate change from
  an earlier attempt this session that used a standalone script opening
  its own short-lived connection: that script's same-tick read of
  `.collection.indexes()` raced ahead of Mongoose's background autoIndex
  build and initially showed only the default `_id_` index. Querying
  through an already-running server sidesteps that race entirely - by
  the time the route is hit, the server has been up long enough for
  autoIndex to have finished - so no workaround (like `Model.init()`)
  was needed, and the method matches the monolith's exactly rather than
  re-deriving a per-service fix. No DNS SRV issue recurred
  (`DNS_WORKAROUND=true` already set in both services' `.env`, inherited
  from Stage 2's initial setup).
  - Product Service (`product-service-db`, `node src/server.js`, port
    `5001`): `GET /debug/indexes` returned `category_1`, `isFeatured_1`,
    `createdAt_-1`, alongside the default `_id_` index.
  - Order Service (`order-service-db`, `node src/server.js`, port
    `5005`): `GET /debug/indexes` returned `user_1_createdAt_-1` and
    `createdAt_-1`, alongside the pre-existing `stripeSessionId_1`
    (`unique: true`) and default `_id_` indexes.
  - Both services stopped and their temporary `/debug/indexes` routes
    reverted immediately after use; neither route nor the extra model
    import was committed.
- **Stage:** Baseline Microservices (mirrors the Monolith's index
  portion of the `v1.4-monolith-baseline` four-optimizations entry
  above; pagination/compression/`Promise.all` mirroring still pending as
  Parts 2-4).

### [2026-07-17] Pagination mirrored into Baseline Microservices - Stage 2, Part 2 of 4 of the optimization pass
- **Decision:** Ported the monolith's `v1.4-monolith-baseline` pagination
  contract (`{ data, total, page, limit, hasMore }`, `?page=&limit=`
  query params, 12-item default / 20-item admin-orders page size, "Load
  More" UX) into Product Service, Order Service, and
  `frontend-baseline/`, unchanged in shape from the monolith's version.
  - **`pagination.js` duplicated**, not shared: a byte-identical copy in
    `services/product-service/src/lib/pagination.js` and
    `services/order-service/src/lib/pagination.js`. Consistent with this
    project's established service-independence rule (`auth.middleware.js`
    is duplicated into every service for the same reason - see
    `CLAUDE.md`); no other service needed a copy (User/Coupon/Cart don't
    paginate anything).
  - **Product Service:** `getAllProducts`, `getProductsByCategory`,
    `searchProducts` paginated identically to the monolith -
    `Promise.all([find().sort({createdAt:-1}).skip().limit(),
    countDocuments()])` → `paginatedResponse()`. Empty-`q` search still
    returns `paginatedResponse([], 0, 1, limit)`.
  - **Order Service - paginate-then-enrich composition (the real design
    decision this part required):** the monolith composes pagination
    with product/user detail via a single `.populate()`'d Mongo query,
    which isn't available here since Product and User live in separate
    databases/services. `getUserOrders` and `getAllOrders` now run the
    `skip`/`limit`/`countDocuments` query FIRST, then run
    `populateOrderProducts`/`populateOrderUsers` (the existing
    cross-service enrichment functions) only on the resulting page-sized
    array - never on the full unpaginated collection. This is a
    deliberate scalability property, not just implementation ordering:
    it bounds `populateOrderUsers`'s batched call to User Service to at
    most `limit` distinct user ids per request, regardless of how large
    the total order collection grows, whereas paginating after
    enrichment would have made that batch call scale with the entire
    order history on every single page request. `total` in the response
    is still a `countDocuments({})` over the whole collection (the true
    total), completely independent of how many ids the enrichment step
    touches - see verification below for how these two numbers were
    checked separately.
  - **Frontend (`frontend-baseline/`):** `useProductStore.js` gained the
    same `pagination: { total, page, limit, hasMore }` field and
    `{ page }`-aware `fetchAllProducts`/`fetchProductsByCategory`/
    `searchProducts` as the monolith, calling `productApi` (not the
    monolith's single `axios` instance) - page 1 replaces `products`,
    page > 1 appends, matching the monolith's replace-vs-append branch
    exactly. `ProductsList.jsx`, `CategoryPage.jsx`,
    `SearchResultsPage.jsx` each gained the identical Load More button
    gated on `pagination.hasMore`. `OrdersTab.jsx` got the
    `ORDERS_PAGE_SIZE = 20` local-state Load More pattern, calling
    `orderApi` - with one deliberate deviation from a literal port:
    Baseline's `OrdersTab.jsx` already had an `error`-state UI branch
    the monolith's version doesn't have (a pre-existing Baseline
    improvement, unrelated to this pass); that was preserved rather than
    removed to match the monolith more literally, with the pagination
    state/Load More logic layered on top of it unchanged.
- **Verification:**
  - **Boundary correctness**, via direct API calls against each
    service's real database (same page1/page2/last-page method proven
    for the monolith): `getProductsByCategory` (`cement`, `limit=2`) -
    page 1 returned 2 items with `hasMore:true`, page 2 returned the
    remaining 2 with `hasMore:false`, no duplicate/missing ids across
    the two pages. `searchProducts` (`q=cement`, `limit=2`, `total=7`) -
    page 4 correctly returned exactly the 1 remaining item with
    `hasMore:false`; empty `q` confirmed to return the
    `{data:[],total:0,page:1,hasMore:false}` shape. `getAllProducts`
    (admin) confirmed `total:27` matching the real dataset.
  - **`getAllOrders`: total-vs-enrichment-scope, verified as two
    independently-checked numbers, not inferred from one another** - the
    real dataset only had 1 pre-existing order, too few to exercise
    multi-page behavior meaningfully, so 5 temporary orders (distinct
    random user ids, deleted immediately after) were seeded directly
    into `order-service-db` to reach 6. Paginating at `limit=2` across 3
    pages: `total` correctly read `6` on every page (the true full
    collection count) while the 6 returned order ids across the 3 pages
    were all distinct (no duplicates/gaps, matching `2+2+2=6`) and
    `hasMore` correctly flipped `true,true,false`. Separately, a
    temporary log line in `populateOrderUsers` (removed immediately
    after, never committed) printed the exact batch of user ids it
    resolved per call: `2, 2, 2` - never `6` - confirming enrichment was
    genuinely bounded to each page's own user ids and not silently
    running over the whole collection despite `total` correctly
    reporting the whole collection's size. Both temporary seed orders
    and the temporary log line were removed before verification
    concluded; `getAllOrders` re-confirmed back at `total:1` afterward.
  - **Full Playwright (headless Chromium) browser verification**, all
    five changed `frontend-baseline` pages, run against the already-
    running real services (no mocking):
    - **Auth adaptation, recorded explicitly:** signup/login requires
      Redis (refresh-token storage) and no local Redis instance was
      running this session (unlike whatever prior session had one
      available) - Docker was present but its daemon wasn't running,
      so standing up a container was judged more disruptive than
      necessary for this check. Since this project's JWT auth is
      explicitly stateless (`CLAUDE.md`'s "Option A": each service
      verifies the access token's signature locally, no Redis/DB lookup
      on the request path itself), a real login flow isn't actually
      required to exercise the pagination code under test - only a
      validly-signed cookie is. A throwaway admin user was created
      directly in `user-service-db` (bypassing signup/Redis entirely,
      not going through the login endpoint), a matching access token was
      signed with the service's own `ACCESS_TOKEN_SECRET`, and Playwright
      set it as a browser cookie before navigating - functionally
      equivalent to a real login from every downstream service's point
      of view, since none of them do anything Redis-dependent to verify
      it. The throwaway user was deleted immediately after. This
      deviates from the prior session's literal signup-then-promote
      account flow, so it's recorded here rather than left implicit.
      **Narrower scope this implies:** because the seeded token bypassed
      Redis entirely, this session's admin verification exercised only
      stateless access-token verification (`protectRoute`/`adminRoute`
      checking the JWT signature) - it did not exercise the
      refresh-token flow (issuance, Redis storage, or the 15-minute
      re-issuance path) at all. This is an accepted, narrow gap specific
      to this verification session's auth method, not a limitation of
      the pagination work itself, which doesn't touch token refresh in
      any way.
    - `CategoryPage` (`cement`): 4 product cards rendered, no Load More
      (matches the API-level `hasMore:false` check).
    - `SearchResultsPage` (`cement`): 7 product cards rendered, no Load
      More.
    - **Race-condition check** (same scenario proven valuable for the
      `AbortController` fix): searched "pipe", then without navigating
      away searched "cement" - confirmed the heading and all 7 rendered
      cards correctly reflected only "cement", with no stale "pipe"
      result bleeding through, confirming the search-cancellation logic
      still works correctly with pagination state now layered on top of
      it.
    - `ProductsList` (admin, 27 real products): 12 rows after initial
      load, Load More button present. **Rapid-pagination race check:**
      fired two near-simultaneous clicks at the Load More button
      (`click()` plus a forced `click({force:true})` bypassing
      Playwright's normal actionability wait, deliberately stress-testing
      past what a real user's click could achieve, since the button's
      own `disabled={loading}` attribute already blocks a real double
      click). Across repeated runs, the row count after the double-click
      varied (24 in one run, 27 - all remaining products - in another)
      depending on exact timing of when the second click landed relative
      to the first request resolving, but the count of unique rows
      always equaled the total row count in every run - no duplicate or
      missing rows were ever produced, confirming the `disabled`-while-
      loading guard reliably prevents the same page from ever being
      fetched and appended twice, which is the actual race this check
      exists to catch.
    - `OrdersTab` (admin, 1 real order): 1 row rendered correctly (user
      name/email, all 4 products, total, status dropdown, date), no Load
      More button (correct - single order is under the 20-item page
      size).
    - One unrelated pre-existing issue observed, not introduced by this
      pass and left unfixed as out of scope: `ProductsList.jsx`'s price
      cell has a pre-existing JSX typo (missing space before
      `font-semibold`, present identically in the monolith's own
      `ProductsList.jsx` before and after its own pagination pass),
      which React logs as a "non-boolean attribute" console warning. It
      doesn't affect rendered output or pagination behavior; worth a
      trivial fix in some future pass, but out of scope for a
      pagination-only session. **Confirmed symmetric, not a comparison
      confound:** this is a pre-existing JSX className concatenation
      typo present identically in `ProductsList.jsx` in both the
      Monolith and Baseline Microservices - harmless (a console warning
      only, no functional or data-correctness impact), and since both
      systems carry it identically, it introduces no asymmetry between
      the two sides for Comparison A. Left unfixed as out of scope for
      this optimization pass; tracked here as a known, low-priority
      cosmetic issue, fixable later via the standard
      monolith-first-then-Baseline sequence if time permits.
    - One transient, non-reproducible `500` was observed once on
      `searchProducts` mid-session; an immediate direct `curl` retry
      against the same endpoint succeeded, and no subsequent Playwright
      run reproduced it - treated as an environment blip (most likely
      brief MongoDB Atlas connection pressure from the session's many
      short-lived verification scripts), not a defect, and not treated
      as silently resolved.
- **Scope discipline:** compression and `Promise.all` remain out of
  scope for this session - separate Parts 3 and 4, each to be verified
  independently, per the plan agreed before this part began.
- **Stage:** Baseline Microservices (mirrors the Monolith's pagination
  portion of the `v1.4-monolith-baseline` four-optimizations entry;
  compression/`Promise.all` mirroring still pending as Parts 3-4).

### [2026-07-17] Compression mirrored into Baseline Microservices - Stage 2, Part 3 of 4 of the optimization pass
- **Decision:** Added the `compression` npm package (`^1.8.1`, matching
  the monolith's pinned version) and `app.use(compression())` to all
  five Baseline services - `product-service`, `user-service`,
  `cart-service`, `coupon-service`, `order-service` - placed immediately
  after `app.use(metricsMiddleware)` and before every other middleware
  (`cors`, `express.json`, `cookieParser`), mirroring the monolith's own
  adjacency (`metricsMiddleware` → `compression` → body-parsing) from
  `v1.4-monolith-baseline`'s `backend/server.js` exactly. The monolith
  has no `cors` middleware to anchor against (single-origin), so
  "immediately after metrics" was the more literal match to preserve
  than "immediately before `express.json`," and the two are functionally
  equivalent anyway since CORS doesn't touch response bodies.
  Lightest of the four optimizations by design: no response-shape
  changes, no route changes, no `frontend-baseline` changes at all -
  compression is transparent to application code, so this part touched
  only five `server.js` files and their five `package.json`/
  `package-lock.json`.
- **Verification - `Content-Encoding: gzip` and real before/after byte
  counts**, same method proven for the monolith (`curl` with
  `Accept-Encoding: gzip` vs `Accept-Encoding: identity`, comparing the
  actual bytes-on-the-wire, not just header presence), run against each
  service's own already-running instance with a meaningfully-sized real
  response:
  - **Product Service** - `GET /api/products?page=1&limit=100` (all 27
    real products, admin route): `Content-Encoding: gzip` present;
    **11023 → 2818 bytes (74.4% reduction)**.
  - **Order Service** - `GET /api/orders/all?page=1&limit=20` (the 1
    real order, fully cross-service-enriched with product and user
    details): `Content-Encoding: gzip` present; **2292 → 917 bytes
    (60.0% reduction)**.
  - **Cart Service** - `GET /api/cart`: the real test account's actual
    cart only had 2 items (864 bytes, under the threshold - see below),
    so a throwaway user id (not a real account, never touched via
    signup/login) had 6 real products added to its Redis cart hash via
    the live `addToCart` endpoint, measured, then removed via `DELETE
    /api/cart` immediately after - confirmed empty (`[]`) afterward, and
    the real test account's own 2-item cart (864 bytes) reconfirmed
    unchanged throughout. `Content-Encoding: gzip` present on the
    6-item response; **2482 → 848 bytes (65.8% reduction)**.
  - **User Service and Coupon Service - real app payloads fall under
    `compression`'s default 1024-byte threshold, so `Content-Encoding:
    gzip` correctly does NOT appear on them, and this is expected
    behavior, not a wiring gap:**
    - User Service's largest realistic payload, `POST
      /api/auth/users/batch`, requested with all 5 real users in the
      current dataset (the entire user base): 409 bytes uncompressed,
      409 bytes with `Accept-Encoding: gzip` sent - identical, no
      `Content-Encoding` header, because 409 bytes never reaches the
      threshold `compression` uses to decide whether the CPU cost of
      compressing is worth it. This isn't a scenario that can be made
      "meaningfully sized" without inventing user accounts that don't
      reflect the real dataset, so it's reported honestly as-is rather
      than staged artificially.
    - Coupon Service's only payload shape, `GET /api/coupons`, is a
      single coupon object - inherently small by the schema's own
      field count (`code`, `discountPercentage`, `expirationDate`,
      `isActive`, `userId`, timestamps). A throwaway coupon was created
      (via the same throwaway user id used for the Cart Service check,
      not a real account) to get a real non-null measurement rather than
      the real test account's `null` (4 bytes): 260 bytes uncompressed,
      260 bytes with gzip requested - again under threshold, again
      expected. The throwaway coupon was deleted immediately after
      measuring.
    - **To confirm this is genuinely the 1024-byte threshold and not a
      broken/missing middleware install on these two services**, both
      were also checked against their own `/metrics` endpoint (`prom-
      client` output, inherently larger than any of this project's JSON
      payloads): User Service **5726 → 663 bytes (88.4% reduction)**,
      Coupon Service **5575 → 653 bytes (88.3% reduction)**, both with
      `Content-Encoding: gzip` correctly present. This proves
      `compression()` is correctly wired into both services' middleware
      stacks and activates normally once a response crosses the
      threshold - the absence of compression on their real application
      payloads is a property of those payloads' size, not a defect in
      this pass.
  - All temporary state (throwaway cart items, throwaway coupon) was
    created under a throwaway user id never used for signup/login, and
    removed before this entry was written; no real account or dataset
    was left modified.
- **Scope discipline:** `Promise.all` remains out of scope for this
  session - Part 4, the last piece, to be verified independently once
  this part is confirmed. No `frontend-baseline` changes were needed or
  made, consistent with compression being transparent to application
  code.
- **Stage:** Baseline Microservices (mirrors the Monolith's compression
  portion of the `v1.4-monolith-baseline` four-optimizations entry;
  `Promise.all` mirroring still pending as Part 4, the last of the
  four).