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