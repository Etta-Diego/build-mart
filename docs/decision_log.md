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

### [2026-07-17] Promise.all mirrored into Baseline Microservices - Stage 2, Part 4 of 4, completing the optimization pass on both stages
- **Decision:** Ported `deleteProduct`'s Cloudinary+MongoDB parallel
  deletion into Product Service, confirmed the client-side Analytics
  composition already used `Promise.all` (no change needed), and - per
  the explicit instruction to audit Product Service and Order Service
  more broadly rather than assume only the two known candidates
  remained - found and parallelized two further genuinely-independent
  sequential operations in Order Service that had emerged from work
  since the original audit (pagination's enrichment functions, Stage 2
  Part 2):
  - **Product Service `deleteProduct`:** identical pattern to the
    monolith - `destroyImage()` (Cloudinary, swallows its own errors)
    and `Product.findByIdAndDelete()` wrapped in `Promise.all`, ported
    verbatim from `v1.4-monolith-baseline`.
  - **Analytics (`frontend-baseline/src/components/AnalyticsTab.jsx`):**
    already used `Promise.all([userApi.get(...), productApi.get(...),
    orderApi.get(...)])` for its three-service composition - this was
    built correctly from the start, not overlooked. No code change.
  - **`getOrderSummary` (Order Service, new in Baseline, no monolith
    equivalent as a standalone endpoint):** the all-time totals
    aggregate and the 7-day daily-breakdown aggregate are two
    independent queries against the same `Order` collection - neither
    reads the other's result - so they're now run via `Promise.all`
    instead of one after the other.
  - **`getAllOrders` and `updateOrderStatus` (Order Service) - the
    broader-audit finding:** both call `populateOrderProducts`
    (products, per-order/batched, best-effort) and `populateOrderUsers`
    (users, batched) to enrich orders. In the monolith this is one
    `.populate()` call; decomposing it into two separate cross-service
    helpers when Baseline extracted Product/User into their own
    services (and later, Stage 2 Part 2's pagination work) left them
    sequential - products enrichment fully completing before user
    enrichment started - purely as an artifact of how the code evolved,
    not a real dependency: neither function reads a field the other
    writes. Both now start concurrently:
    - `getAllOrders`: `Promise.all([Promise.all(orders.map(populateOrderProducts)),
      populateOrderUsers(orders.map(o => o.toObject()))])`, then merged
      back together by `_id` afterward (each order needs both its
      enriched `.products` from one branch and its resolved `.user`
      from the other).
    - `updateOrderStatus`: same independence, but written without a
      literal `Promise.all` - the existing best-effort fallback on a
      total User Service outage needs `withProducts` (the product-
      enriched order) still available inside the `catch` block, which a
      destructured `Promise.all` rejection wouldn't provide. Both
      promises are started immediately, `withProducts` is awaited
      separately, and `usersPromise`'s resolution/rejection is handled
      in its own `try` - functionally concurrent, without losing the
      partial result on failure.
- **A real bug found and fixed during verification, not by design
  review alone:** the first version of `updateOrderStatus`'s "start
  both, await separately" pattern created `usersPromise` and left it
  unawaited while `productsPromise` was awaited first - and Node
  flags a promise that rejects before anything has awaited or attached
  a rejection handler to it as an **unhandled rejection, which
  terminates the process by default**. This is exactly what happened
  when the User-Service-down fallback path was tested: Order Service
  crashed instead of returning the expected best-effort response.
  Fixed by attaching a no-op `usersPromise.catch(() => {})`
  immediately after creating it, which marks the rejection as
  "handled" for Node's detector without consuming or altering what the
  real `try`/`await` below observes when it runs. `getAllOrders` was
  checked for the same risk and confirmed safe: both promises there are
  constructed directly inside the `Promise.all([...])` array literal,
  so `Promise.all` attaches its own handlers to both synchronously, in
  the same tick, before either can reject unobserved. This is recorded
  here explicitly because it's the kind of subtle correctness gap that
  a design walkthrough alone would not have caught - it only surfaced
  by actually killing User Service and exercising the fallback path for
  real, the same rigor already applied to every other part of this
  pass.
- **Verification:**
  - **`deleteProduct` - output-equivalence and real timing, run against
    both systems in the same session for a direct comparison** (the
    monolith's own Stage 1 Part 4 entry recorded only qualitative
    confirmation - "confirmed to complete... matching the original
    sequential version's effects" - not a quantified number, so both
    were freshly measured here rather than one side missing a real
    figure to compare against): a real product with a genuine Cloudinary
    image was created then deleted in each system, with temporary
    `Date.now()` instrumentation (reverted immediately after, confirmed
    via `git diff` showing an empty diff on `backend/controllers/
    product.controller.js` afterward - the monolith was not left
    modified) timing the Cloudinary destroy call, the MongoDB delete,
    and the actual `Promise.all` wall-clock separately:
    - **Monolith:** MongoDB delete 418ms, Cloudinary destroy 2999ms,
      actual parallel wall-clock **3000ms** (≈ `max(418, 2999)`,
      confirming genuine parallelism) vs. a **3417ms**
      sequential-equivalent (`418 + 2999`) - **417ms saved (12.2%)**.
    - **Baseline (Product Service):** MongoDB delete 300ms, Cloudinary
      destroy 2402ms, actual parallel wall-clock **2403ms** (≈
      `max(300, 2402)`) vs. a **2702ms** sequential-equivalent - **299ms
      saved (11.1%)**.
    - In both systems, Cloudinary's network round trip to an external
      service dominates and is the long pole either way - `Promise.all`
      shifted the total from "sum of both" to "max of both," saving
      almost exactly the shorter operation's own duration, in both
      systems. The two systems' absolute Cloudinary/Mongo latencies
      differ (same external Cloudinary account, different Atlas
      shard/database per system, ordinary request-to-request variance),
      but the *shape* of the improvement - parallel wall-clock tracking
      the max, not the sum - is identical between them, which is the
      actual claim this optimization makes.
  - **`getOrderSummary`:** confirmed internally consistent -
    `totalSales: 1`, `totalRevenue: 76.89`, and `dailySalesData` showing
    the sale on exactly `2026-07-15` with matching revenue and zero
    elsewhere - matching the known real dataset, same numbers already
    confirmed in this file's Stage 1 four-optimizations entry.
  - **`getAllOrders` merge correctness** - the one part of this session
    genuinely at risk of a real bug, since the new `_id`-keyed merge is
    new code, not just added concurrency: the real dataset only has 1
    order, too few to catch a user/product misalignment (a merge bug
    could coincidentally look correct with only one row). Three
    temporary orders (deleted immediately after) were seeded with three
    distinct real users, each paired with a distinct, identifiable
    product, specifically so a swapped pairing would be immediately
    obvious. Across 3 repeated calls, every order's returned `.user`
    and `.products` correctly matched their own seeded pairing every
    time - no swaps, no misalignment. One of the four orders'
    product came back as an unresolved raw id on the very first call
    (not a pairing error - just that one field unresolved) and fully
    resolved on all 3 immediate re-checks after - treated as the same
    category of transient environment blip already documented in this
    file's Stage 2 Part 2 entry (a brief Product Service/Atlas hiccup
    under concurrent load), not a defect in the merge logic itself,
    which was never wrong about *which* order a value belonged to.
  - **`updateOrderStatus`:** happy path confirmed on the real order
    (status changed `pending` → `processing`, full product and user
    enrichment present, then reverted back to `pending` to leave the
    real order unchanged) both before and after the unhandled-rejection
    fix. Fallback path re-confirmed after the fix by stopping User
    Service entirely and re-running the same status update: **200
    response** (not a crash), status write correctly persisted,
    products fully enriched, user gracefully degraded to `"Unknown
    User"` - matching the documented best-effort contract exactly, no
    process crash. `getAllOrders`'s fail-loud contract was checked in
    the same User-Service-down window and confirmed unaffected: still a
    clean `500` with the expected message, no crash. User Service was
    restarted and the real order's status reconfirmed reverted to
    `pending` with the user correctly re-resolved to `"Etta Onyii"`
    afterward.
  - All temporary state (test products with real Cloudinary uploads,
    seeded merge-test orders) was created under throwaway/temporary
    records and removed immediately after measurement; the real
    dataset (27 products, 1 order) was reconfirmed unchanged at the end
    of this part.
- **Stage:** Baseline Microservices, completing the `Promise.all`
  portion of the four-optimizations pass.
- **Milestone: this completes all four optimizations (indexes,
  pagination, compression, `Promise.all`) across both the Monolith
  (`v1.4-monolith-baseline`) and Baseline Microservices.** Both stages
  now carry the same four performance optimizations, applied and
  verified with the same rigor and (where the two are directly
  comparable, as with `deleteProduct`'s timing) the same measurement
  method - keeping implementation quality out of what Comparison A
  (Monolith vs. Baseline) and Comparison B (Baseline vs. Enhanced) are
  meant to measure, per this file's running principle since the first
  four-optimizations entry. Enhanced Microservices (Stage 3) has not
  been started.

### [2026-07-18] Baseline-mirroring commits (2fb7490, 7bf2021, 7e29617, 68bb5ca, 6b804ad) accepted via lighter-touch review, not full re-verification
- **Decision:** These five commits - the four-part optimization pass
  mirrored into Baseline Microservices, plus one re-verification commit -
  were made in a Claude Code session not captured in the current
  conversation transcript (a prior session ended unexpectedly; this
  conversation resumed without memory of that work happening). Rather
  than redo the full verification standard applied elsewhere in this
  project, they were accepted after a lighter-touch review: skimming the
  five commits' diffs, plus one live check (hit Product Service's
  `GET /api/products/category/:category?page=&limit=` directly - response
  matched the documented `{ data, total, page, limit, hasMore }` contract
  exactly: `total: 4, page: 1, limit: 3, hasMore: true` for the `cement`
  category, consistent with the monolith's own verified result for the
  same category).
- **Rationale:** Time constraints on this pass of the project didn't
  allow for redoing the same exhaustive verification (direct-DB index
  checks, full Playwright runs per service, live before/after byte
  counts, etc.) the commits themselves already claim to have done. The
  diffs read as genuine, careful engineering rather than superficial
  mirroring - notably `6b804ad`'s fix for a real unhandled-rejection
  crash risk in `updateOrderStatus`'s concurrent enrichment, which is not
  the kind of detail a low-effort mirror would surface - so the claims in
  each commit message were judged credible on inspection rather than
  re-proven from scratch.
- **What this is not:** this is not the same standard of confidence as
  every other verified entry in this file. It is recorded honestly as a
  lighter-touch acceptance, not upgraded to "verified" after the fact.
  If a discrepancy in Baseline Microservices' behavior surfaces later,
  this entry is the place to look first.
- **Stage:** Baseline Microservices.

### [2026-07-20] docker-compose.yml extended to run all five Baseline services alongside local Mongo/Redis
- **Decision:** Added `product-service`, `user-service`, `cart-service`,
  `coupon-service`, and `order-service` to the root `docker-compose.yml`,
  alongside the pre-existing `mongo`/`redis` dev-infra services. Each
  service: `build:` points at its own `services/<name>/Dockerfile`;
  `env_file: ./services/<name>/.env` loads its real secrets unchanged
  (Cloudinary, Stripe, `ACCESS_TOKEN_SECRET`, `INTERNAL_SERVICE_KEY`,
  etc.); an `environment:` block overrides only the network-topology
  vars (`MONGO_URI`, `REDIS_URL`, inter-service `*_SERVICE_URL`s) to
  point at Docker network service names (`mongo`, `redis`,
  `product-service`, etc.) instead of `localhost`. `cart-service` has no
  `MONGO_URI` override and no `mongo` in `depends_on` - confirmed via its
  `.env.example`, it has no Mongo dependency at all (Redis-backed cart
  data, per the Stage 2 Cart-as-Redis-Hash decision already on record).
  Each service keeps its own logical database on the shared `mongo`
  container (`product-service-db`, `user-service-db`, etc.), matching
  each service's existing `.env.example` with only the host swapped.
- **Naming collision hit, and its resolution:** running `up` under a
  deliberately distinct project name (`-p buildmart`, no hyphen, chosen
  specifically to avoid repeating the collision `docker-compose.sanity-
  check.yml`'s own header already documents) failed instead:
  `build-mart-mongo-1`/`build-mart-redis-1` were already running under
  Compose's implicit default project name (`build-mart`, hyphenated,
  derived from the folder name) from an earlier, plain `docker compose
  up` with no `-p` flag - so the new `buildmart` project's `mongo`/
  `redis` containers collided on the same host ports (27017, 6379)
  instead. Resolved by using `-p build-mart` (matching the already-
  running project exactly) instead of inventing a new name - this
  attaches to/extends the existing project rather than creating a
  parallel one, reusing the already-running `mongo`/`redis` containers
  as-is and just adding the five new service containers to that same
  project. Confirmed before switching that the existing local `mongo`
  container held no real data worth preserving (only `admin`/`config`/
  `local` system databases - the actual application data lives in
  Atlas, per every service's real `.env`). The failed `buildmart`
  (no-hyphen) attempt's empty containers/network/volumes were torn down
  and removed before retrying.
- **Verification:** `docker compose -p build-mart build` succeeded for
  all five images; `up -d` brought up all 7 containers, all 5 services
  reaching Docker's own `(healthy)` status via their Dockerfile-defined
  `/metrics` healthchecks. Then ran a genuine, complete end-to-end order
  flow through the running containers, not a mock:
  1. Signed up a throwaway user via containerized User Service, promoted
     to admin via a direct `docker exec mongosh` write against the
     local container's `user-service-db` (low-risk - local-only
     throwaway test infra, not the shared Atlas cluster), logged in
     again to pick up the refreshed role in the JWT.
  2. Created a throwaway product via containerized Product Service
     (real Cloudinary upload, same account used throughout this
     project).
  3. Added it to cart via containerized Cart Service - confirmed Cart
     Service's cross-service call to Product Service over the internal
     Docker network (`PRODUCT_SERVICE_URL=http://product-service:5001`)
     correctly resolved full product details.
  4. Created a Stripe Checkout Session via containerized Order Service -
     unlike the Monolith's documented placeholder-Stripe-key gap, Order
     Service's real `.env` has a genuine Stripe **test** secret key, so
     a full live round-trip was actually possible here.
  5. Fetched the session's hosted checkout URL directly from Stripe's
     API and drove it with Playwright (headless Chromium), filling
     Stripe's own test card (4242 4242 4242 4242) and submitting -
     genuinely completes a real Stripe test-mode payment, not a
     simulated one. Confirmed redirect to the configured
     `success_url` with the session id attached.
  6. Called Order Service's `checkout-success` with that session id -
     response confirmed `success: true` and a real `orderId`.
  7. Confirmed the order via direct fetch and via the paginated
     `getUserOrders` list (correct product/price/`stripeSessionId`,
     `total: 1`, `hasMore: false`); confirmed Cart Service's cart was
     actually emptied afterward (best-effort `clearCart` call from
     `checkoutSuccess` succeeded).
  8. Cleaned up all throwaway state: order, product, and user deleted
     directly from their respective local databases, plus the orphaned
     Cloudinary test image (created via direct product deletion outside
     the API, so its own Cloudinary-cleanup `Promise.all` never ran -
     removed separately via a direct signed Cloudinary API call).
     Re-confirmed all 7 containers still `(healthy)`/`Up` afterward.
- **Rationale:** This is the first time Baseline Microservices' actual
  inter-service HTTP calls (Cart → Product, Order → Cart/Coupon/Product/
  User) have been exercised over a real Docker network rather than each
  service running as a bare `node` process reachable via `localhost` -
  a meaningfully different, more representative test of the
  microservices deployment topology this dissertation's Comparison B is
  actually about, and a natural precursor to the Kubernetes work Stage 3
  will build on.
- **Stage:** Baseline Microservices (containerization/local orchestration
  groundwork for Stage 3).

### [2026-07-20] frontend-enhanced/ created ahead of the API Gateway, using Baseline's direct-service-URL pattern as a deliberate, temporary stopgap
- **Decision:** Created `frontend-enhanced/` as a genuine copy of
  `frontend-baseline/` (`robocopy /E`, excluding `node_modules`/`dist`,
  then an independent `npm install` - the same "duplicate, don't share"
  pattern used for `frontend-baseline/`'s own creation, and explicitly
  predicted in that entry). `frontend-baseline/` itself confirmed
  untouched via `git status` before and after.
  - Points at the same five direct service URLs (`localhost:5001`-
    `5005`) `frontend-baseline` uses - **this is temporary**, since
    Stage 3's API Gateway doesn't exist yet. A `// TODO` comment in
    `src/lib/api.js` and a comment block in `.env.example` both state
    explicitly: once the API Gateway is built, replace these five URLs
    with a single Gateway URL.
- **Rationale:** Building the Enhanced frontend now, ahead of the
  Gateway it will eventually depend on, unblocks local testing of
  Enhanced Microservices work as it's built and avoids port confusion
  between three otherwise-identical frontends - at the cost of
  `frontend-enhanced/` not yet reflecting its actual target
  architecture (single Gateway origin). This is explicitly **not** the
  final Enhanced configuration; it will need revisiting once the
  Gateway exists.
- **Stage:** Enhanced Microservices (frontend scaffolding, ahead of the
  Gateway).

### [2026-07-20] Visual "app label" badge added to all three frontends - genuinely new work, not a retrofit
- **Decision:** Added a small, fixed-position, non-functional visual
  indicator distinguishing which architecture stage a given frontend is
  talking to, to all three frontends at once (`frontend/`,
  `frontend-baseline/`, `frontend-enhanced/`). Before building this, an
  exhaustive search (`grep` across all three `src/` trees for "badge"/
  "Monolith"/"Baseline Microservices", `git log --all`, `git stash
  list`, and a byte-for-byte diff of both existing `App.jsx` files)
  confirmed **no such feature existed anywhere in this codebase** -
  despite having been proposed earlier in this project, it was never
  actually implemented. This entry is that implementation, not a fix or
  an update to prior work.
  - **Design:** a fixed-position corner badge (bottom-right, `position:
    fixed`, high `z-index`, `pointer-events: none`), not a strip above
    `Navbar` - chosen specifically because it requires zero changes to
    `Navbar.jsx`'s own layout/positioning in any of the three frontends
    (a strip above `Navbar` would need `Navbar`'s `top-0` and the page
    wrapper's `pt-20` adjusted to avoid overlap, in triplicate). Plain
    inline CSS and text only, no images, no additional network
    requests - deliberately inert with respect to every metric this
    project measures (startup time, page weight, etc.).
  - **One identical component (`src/components/AppBadge.jsx`), copied
    verbatim into all three frontends** - reads `VITE_APP_LABEL`/
    `VITE_APP_COLOR` from each frontend's own `.env`, so the only thing
    that differs per frontend is two environment variable values, not
    the code:
    - `frontend/`: `"Monolithic Architecture"`, `#666666` (gray)
    - `frontend-baseline/`: `"Baseline Microservices"`, `#4A86E8` (blue)
    - `frontend-enhanced/`: `"Enhanced Microservices"`, `#2E7D32` (green)

    Colors match the convention already used in this project's
    architecture diagrams.
  - Each frontend's `index.html` `<title>` updated to match
    (`"BuildMart - <label>"`), so the browser tab itself is
    distinguishable too, not just the in-page badge.
- **Rationale:** With three near-identical frontends now existing
  side-by-side (and, per Docker/local-dev workflows, potentially running
  concurrently on different ports), a purely visual, zero-risk way to
  tell at a glance which stage's frontend is currently open in the
  browser has real value - especially now that `frontend-enhanced/`
  exists per the entry directly above, and confusion between it and
  `frontend-baseline/` is exactly the kind of mistake this guards
  against.
- **Verification:** started each of the three frontends in turn (not
  concurrently) via `npm run dev`, confirmed via Playwright screenshot
  that each shows its own correctly colored/labeled corner badge and
  its own browser tab title, and confirmed `frontend-enhanced`
  correctly talks to the running `build-mart-*` Docker containers from
  the prior entry.
- **Stage:** All three (Monolith, Baseline Microservices, Enhanced
  Microservices) - purely visual, non-functional, does not affect any
  measured metric.

### [2026-07-22] Local Docker MongoDB seeded with the product catalog - a separate database that had simply never been seeded, not a bug
- **Decision:** Ran `scripts/seed-products.js` against the local
  Dockerized MongoDB (`mongodb://localhost:27017/product-service-db`,
  the database the `build-mart-*` containers use) via a one-off
  environment variable override at invocation
  (`MONGO_URI="mongodb://localhost:27017/product-service-db" node
  scripts/seed-products.js`), not by editing the real `.env`. `dotenv`
  never overwrites an already-set `process.env` value, so the shell
  prefix took precedence over both the script's own `dotenv.config()`
  call and `backend/lib/db.js`'s - confirmed directly by the printed
  `MongoDB connected: localhost` line, not just assumed from the
  override logic.
  - Discovered while debugging why `frontend-enhanced` showed "No
    products found" on every category page (see the two entries
    immediately above) - direct API checks against
    `product-service:5001` showed `total: 0` for every category before
    this, confirming the local Docker Mongo was simply never seeded,
    a genuinely separate, independent database from every Atlas
    database this project already uses (the Monolith's `buildmart` and
    each service's own `<service>-service-db`) - not data loss, not a
    bug, just a database that hadn't had this one-time step done yet.
  - Atlas's own configuration and data were not touched by this in any
    way - the override is invocation-scoped only, confirmed by
    re-inspecting the real `.env` afterward (still points at
    `cluster0.2cibdjn.mongodb.net/buildmart`, unchanged).
  - This creates a **second, independent set of Cloudinary uploads**,
    distinct from the ones already created against Atlas's databases -
    expected and accepted, not a concern, since Cloudinary storage
    isn't a constrained resource this project is tracking.
- **Verification:** the script's own output confirmed `Created: 27,
  Skipped: 0` with a per-category breakdown (cement/pipes/plank/rods/
  roofing-sheet/wall-paints: 4 each, water-tank: 3 - 27 total, matching
  the script's own documented distribution). Independently re-confirmed
  via direct API calls against the running, already-verified
  `product-service:5001` for all seven categories - each returned the
  same count as the seed script reported, each with a real, freshly
  uploaded Cloudinary image URL (`res.cloudinary.com/dnsq75g1h/...`),
  not a placeholder.
- **Stage:** Enhanced Microservices (local Docker dev infra - the same
  seeding gap would equally have affected Baseline Microservices' own
  local Docker run, had it been brought up against this database first;
  recorded under Enhanced since that's the branch/session this was
  found on).

## [2026-07-22] WSL2's Redis was unreachable from Windows-side Node processes - a known localhost-bridging gap, resolved via Docker-hosted Redis instead

- **Context:** running Baseline services as plain Node processes on
  Windows (not containerized) requires a reachable Redis instance for
  the Cart service. WSL2 has its own `redis-server`, which responded
  correctly to `redis-cli ping` from inside WSL itself, but Windows-side
  Node processes could not connect to it.
- **Diagnosis:** `Test-NetConnection` from Windows against WSL2's Redis
  port showed `TcpTestSucceeded: False`, confirming the port simply
  wasn't reachable from the Windows side, despite Redis being up and
  healthy inside WSL. This is a known WSL2 localhost-bridging gap (WSL2's
  networking doesn't reliably forward every listening port back to
  Windows `localhost` the way WSL1 or a native install would) - not a
  Redis misconfiguration, not a wrong port/host, not a firewall rule.
- **Resolution:** used the existing Docker container
  (`build-mart-redis-1`) for Redis instead, since Docker Desktop's own
  port mapping is reliably bridged to Windows `localhost` regardless of
  the WSL2 gap. No code or config changes were needed beyond pointing
  the plain-process services' `REDIS_URL`/`REDIS_HOST` at that
  container's mapped port.
- **Going forward:** for this development environment specifically,
  plain-process Baseline (and Enhanced, where applicable) runs use
  Docker-hosted Redis, while the other four services (user, product,
  coupon, order) remain plain Node processes against Atlas Mongo. This
  is a deliberate hybrid local-dev setup, not the final AWS deployment
  architecture, and not a statement that Redis itself needs to be
  containerized project-wide - it's specifically working around this
  machine's WSL2 networking limitation.
- **Stage:** Baseline Microservices (local dev environment note; applies
  equally to any future plain-process Enhanced Microservices runs on
  this same machine).

## [2026-07-22] Redis-as-cache is not a genuine Baseline/Enhanced contrast point - reclassified, no code change

- **Context:** while preparing Kubernetes manifests for Enhanced
  Microservices, a request to "bring back" the featured-products Redis
  cache in `services/product-service` (framed as something Baseline
  deliberately lacks) surfaced a contradiction already on record in this
  file:
  - The **Product Service extracted** entry above (2026-07-16) confirms
    `product.controller.js`'s Redis featured-products cache (`getFeaturedProducts`/
    `updateFeaturedProductsCache`, 300s TTL) was copied in **verbatim**
    at extraction time, and `services/product-service/.env.example`
    documents `REDIS_URL` as existing specifically for this cache. It
    was never removed.
  - A separate, later 2026-07-16 entry (on the four-optimizations /
    Comparison-B fairness discussion) lists "Redis-as-cache" alongside
    Kubernetes/API-Gateway/CI-CD as an architectural variable meant to
    distinguish Baseline from Enhanced - implying Baseline shouldn't
    have it. That characterization was simply wrong; the code already
    contradicted it on the same day it was written.
- **Decision:** reclassify Redis-as-cache as **not** a Baseline/Enhanced
  contrast point. Both stages have had the featured-products cache since
  Product Service's original extraction, and `services/` is a single
  shared directory across the `baseline-microservices` and
  `enhanced-microservices` branches (unlike the frontends, which are
  genuinely separate copies per stage) - so there was never a
  code-level mechanism for this to differ between the two stages in the
  first place. No code change was made to `services/product-service`.
- **Consequence for Stage 3 Kubernetes prep:** the k8s manifests being
  written for Enhanced Microservices (`k8s/product-service.yaml`, etc.)
  inherit this cache automatically, same as every other consumer of
  `services/product-service`'s existing container image - there is
  nothing to "port" or "reintroduce" for Enhanced specifically. The
  actual Enhanced-only architectural variables for Comparison B remain
  Kubernetes orchestration, the API Gateway, and CI/CD - Redis-as-cache
  is removed from that list.
- **Stage:** Baseline Microservices and Enhanced Microservices (applies
  identically to both, since it's the same shared code).

## [2026-07-22] ECR repositories created; existing Baseline Docker images pushed as Enhanced Microservices' initial deployment artifacts

- **Decision:** created five Amazon ECR repositories via the AWS CLI, one
  per service, in `eu-west-3` (account `706059253443`):
  `buildmart-product-service`, `buildmart-user-service`,
  `buildmart-cart-service`, `buildmart-coupon-service`,
  `buildmart-order-service` (`--image-scanning-configuration
  scanOnPush=true`). Authenticated Docker to the registry via `aws ecr
  get-login-password | docker login`, then tagged and pushed the
  existing local images already proven during the Baseline
  containerization work (`buildmart-<service>:latest`, built by
  `docker compose -p build-mart build` - see the 2026-07-20
  docker-compose entry above), not the `-sanity` or `sanity` tagged
  variants also present locally from the earlier network-collision
  investigation. No Dockerfile or build logic changes were made; this
  reuses the already-verified images as-is.
- **Registry URI:** `706059253443.dkr.ecr.eu-west-3.amazonaws.com`. Filled
  into the `image:` field of all five `k8s/*-service.yaml` Deployments,
  replacing the `<ECR_REGISTRY>` placeholder from the earlier Kubernetes
  manifest prep. The CI/CD workflow file has not been written yet (no
  `.github/workflows/` exists in this repo) - this registry URI will need
  to be filled into that file too once it's created.
- **Verification:** `aws ecr describe-images` confirmed all five
  repositories now contain an image tagged `latest`, matching the digests
  reported by each `docker push` (e.g. product-service
  `sha256:349f40ad...`, matching local image ID `349f40add19f`).
- **Stage:** Enhanced Microservices (ECR/EKS deployment infrastructure;
  the images themselves are Baseline Microservices' images, reused
  unchanged, consistent with the "same implementation, different
  architecture" comparison design already on record in this file).

## [2026-07-22] Cart Service's Redis moved to AWS ElastiCache, not an in-cluster pod

- **Problem:** `k8s/cart-service-secret.yaml`'s `REDIS_URL` was still the
  local-dev placeholder (`redis://localhost:6379`), which has no meaning
  inside a Kubernetes pod - there is no Redis process running alongside
  it in the same network namespace. This needed a real, reachable Redis
  endpoint before cart-service could actually start on EKS.
- **Decision:** provisioned **AWS ElastiCache for Redis**
  (`cache.t3.micro`, single node, cluster mode disabled) rather than
  deploying Redis as an in-cluster pod (e.g. via a Deployment + PVC, or
  the Bitnami/official Redis Helm chart). A managed cache service is
  more representative of how this architecture would actually be run in
  production, and fits this dissertation's framing of Enhanced
  Microservices as the cloud-native, managed-services stage relative to
  Baseline's self-hosted Docker Redis - the Redis Deployment/PVC route
  was available but rejected specifically because it would have made
  Enhanced's "infrastructure" indistinguishable from Baseline's, other
  than orchestration.
- **Infrastructure created:**
  - ElastiCache subnet group `buildmart-redis-subnet-group`, using the
    same 6 subnets as the EKS cluster.
  - A dedicated security group, `sg-010ad27e9c7350a1b`, scoped to this
    Redis cluster only (not shared with any other resource).
  - Cluster ID `buildmart-redis`; endpoint
    `buildmart-redis.fhofw6.0001.euw3.cache.amazonaws.com:6379`.
- **Debugging note:** the first ingress rule on
  `sg-010ad27e9c7350a1b` authorized traffic from the **EKS
  control-plane security group** rather than the actual **worker node**
  security group (`eks-cluster-sg-buildmart-enhanced-1165427489` /
  `sg-082af3989363c59a3`) - pod traffic to ElastiCache comes from node
  ENIs, not the control plane, so this rule looked correct but never
  actually matched traffic, producing `ETIMEDOUT` despite a rule
  "existing." Fixed by re-authorizing ingress on port 6379 from the
  correct node security group. A leftover self-referencing rule
  (`sg-010ad27e9c7350a1b` → itself, created by mistake while chasing this)
  was also removed - see the entry immediately below.
- **NAT Gateway:** confirmed **no NAT Gateway is required** for this -
  ElastiCache traffic between the worker nodes and the cache cluster
  stays entirely within the VPC and never needs outbound internet
  access. This project runs without a NAT Gateway as a cost-optimization
  choice; this is the first decision-log entry to record that
  explicitly, prompted by checking it wasn't a hidden requirement here.
- **Verification:** confirmed connectivity two ways - `redis-cli PING`
  from a temporary throwaway pod against the ElastiCache endpoint
  (`PONG`), and a direct `ioredis` connection test executed inside the
  actual running cart-service pod. After a rollout restart, cart-service
  pod logs show a clean startup with no Redis connection errors.
- **Stage:** Enhanced Microservices.

## [2026-07-22] External access architecture: HTTP API Gateway + VPC Link + single internal NLB, not an ALB/Ingress or per-service Load Balancers

- **Requirement:** all five services are ClusterIP-only (see the
  Kubernetes manifests already on record) and need to be reachable from
  outside the cluster through an HTTP API Gateway with path-based
  routing, without provisioning a public-facing `LoadBalancer` Service
  directly, and within a tight (~$10/month) budget for this piece of
  infrastructure.
- **Options considered:**
  1. **AWS Load Balancer Controller + Ingress** (path-based routing via
     an ALB) - rejected. Requires standing up an IAM OIDC identity
     provider for the cluster, creating a dedicated IAM policy/role for
     the controller, and a Helm install of the controller itself before
     a single route works. That's a meaningful chunk of setup and
     failure surface (OIDC trust misconfiguration, IAM policy drift,
     Helm chart version mismatches) to take on this close to the project
     deadline, for a routing capability the HTTP API Gateway can already
     provide on its own.
  2. **One NLB per service** (5 total, one per port) - rejected on cost:
     roughly $16-20/month per NLB, so 5x that comfortably blows past the
     ~$10 budget for this piece alone.
  3. **Single internal NLB with 5 listeners (one per service port) +
     NodePort Services, with the HTTP API Gateway doing path-based
     routing at the Gateway layer** - **selected**. Each service is
     switched from `ClusterIP` to `NodePort` (a fixed node port per
     service), the single internal NLB gets one listener per port
     forwarding to the matching NodePort, and the HTTP API Gateway's own
     route-to-integration mapping (e.g. `/api/products/*` →
     product-service's NLB listener, `/api/cart/*` → cart-service's,
     etc.) handles the path-based routing that would otherwise require
     an ALB or an Ingress controller.
- **Rationale:** this avoids the Load Balancer Controller / Helm / OIDC
  setup entirely, keeps cost to a single NLB rather than five, and
  reuses HTTP API Gateway's native routing (already the plan for the
  Gateway itself) instead of introducing a second routing layer to do
  the same job.
- **Important clarification for the record:** switching a Service from
  `ClusterIP` to `NodePort` does **not**, by itself, expose it to the
  public internet. A NodePort only opens a port on each EKS worker
  node's network interface, reachable from within the VPC - it has no
  public route of its own. External reachability here comes entirely
  from the chain HTTP API Gateway → VPC Link → internal NLB → NodePort;
  removing any one of those three still leaves the NodePort itself
  unreachable from outside the VPC.
- **Stage:** Enhanced Microservices.

## [2026-07-23] Temporary CORS configuration: all five services' CLIENT_URL set to Baseline's localhost value

- **Decision:** all five services' `CLIENT_URL` environment variable was
  set to `http://localhost:5173`, matching the value already used in
  Baseline Microservices, as a deliberate temporary stopgap. `CLIENT_URL`
  is a plain `env:` entry on each Deployment (see `k8s/*-service.yaml`),
  not a Kubernetes Secret key - it was never included in the Secret
  structure proposed earlier in this file, since it isn't sensitive.
- **This is not the final value.** It will be replaced with
  `frontend-enhanced`'s real deployment URL once that frontend is
  actually deployed and its URL is known. Until then, a browser client
  calling these services from anywhere other than `localhost:5173` will
  be rejected by CORS, same as Baseline's current behaviour.
- **Action item:** once `frontend-enhanced` has a real URL, patch
  `CLIENT_URL` in all five service Deployments (via `kubectl patch`,
  same method used for the NodePort and REDIS_URL changes above) and
  restart all five Deployments to pick up the change. The tracked
  `k8s/*-service.yaml` manifests should be updated to match at the same
  time, as was done here.
- **Stage:** Enhanced Microservices.

## [2026-07-23] PLANNED: WebPageTest for frontend-enhanced's global load performance (not yet executed)

- **Plan:** use WebPageTest (free, tests from ~40+ global locations) to
  measure `frontend-enhanced`'s load performance once it's hosted on
  S3 + CloudFront, from multiple geographic locations (e.g. US East,
  Europe, Asia, South America, Africa).
- **Rationale:** CloudFront's CDN edge caching is expected to reduce
  latency for geographically distant users compared to Baseline's
  single-region EC2 hosting, but this needs to be **measured, not
  assumed**. WebPageTest gives real browser-rendering metrics (Time to
  First Byte, full load waterfall) from actual global vantage points,
  without requiring paid tooling or additional AWS setup.
- **Honesty note for the eventual write-up:** since testing will be run
  from a single operator location (not real distributed user traffic),
  results should be framed as "CDN architecture reduces latency for
  geographically distant requests" rather than overstated claims about
  real-world global user experience at scale.
- **Alternatives considered:** k6 Cloud - rejected for this specific
  test, since multi-region runs are a paid feature beyond a limited
  trial. AWS CloudShell `curl` timing from multiple regions - rejected
  as the primary method, since it measures raw HTTP timing only, not
  full browser load experience, though it could serve as a supplementary
  data point alongside WebPageTest.
- **Status:** PLANNED, not yet executed - to be run once
  `frontend-enhanced` is deployed to CloudFront and, ideally, once
  Baseline's EC2 frontend is also live, for a genuine side-by-side
  comparison.
- **Stage:** Enhanced Microservices (frontend performance evaluation,
  feeds into Chapter 4.7.3.4 Performance Evaluation).

## [2026-07-23] PLANNED: k6 load tests run from an in-region EC2 instance, not a local connection

- **Context:** while manually testing the deployed system, a single
  `curl` request to the API Gateway timed out while every other check
  (the same Gateway seconds later, CloudFront, general internet
  connectivity) succeeded normally. Diagnosed as a transient local
  network blip (residential Wi-Fi/ISP), not an infrastructure issue -
  immediate retries and every other endpoint worked fine, which rules
  out the Gateway, CloudFront, or the cluster as the cause.
- **Decision:** for k6 load testing and startup-time benchmarking across
  Monolith, Baseline, and Enhanced, tests will be run from an **EC2
  instance within `eu-west-3`** (the same region as the infrastructure
  being tested), rather than from a local residential connection.
- **Rationale:** this removes the tester's home internet/ISP as an
  uncontrolled variable from the measurements, so results reflect the
  actual infrastructure's performance rather than being occasionally
  skewed by unrelated local network hiccups - more methodologically
  sound for a cloud architecture performance comparison than testing
  from wherever the researcher happens to be sitting.
- **Additional methodology safeguards to apply during actual benchmark
  runs:**
  - Run each load test 2-3 times, not once, and report the consistent
    pattern rather than a single data point.
  - Use a brief warm-up period before the measured run, to rule out
    cold-start effects (DNS resolution, TCP handshake) skewing results.
  - Any anomalous single-run result should be flagged and excluded with
    justification, not silently included, if it's inconsistent with
    repeated runs.
- **Status:** PLANNED - to be implemented when the k6/load testing phase
  begins, after Monolith and Baseline EC2 deployments exist.
- **Stage:** cross-cutting (applies to all three architectures'
  performance evaluation, feeds into Chapter 4.7.3.4 Performance
  Evaluation).

## [2026-07-23] Monolith deployed to EC2 (v1.4-monolith-baseline); four deployment bugs found and fixed

- **Decision:** deployed the `v1.4-monolith-baseline` tag to a dedicated
  EC2 instance (`t3.small`, Ubuntu 22.04) in its own separate VPC
  (`buildmart-monolith-vpc`, `10.1.0.0/16`), isolated from Enhanced's
  VPC, so each architecture's networking stays independent for a clean
  teardown/redeploy between the upcoming faculty and final defenses.
  - **Stack:** Node.js 20, `pm2` as process manager, Redis installed
    locally on the instance (not ElastiCache - this VPC has no path to
    Enhanced's ElastiCache instance without VPC peering, and a local
    Redis is simpler and matches the Monolith's self-contained
    architecture narrative better than reaching across VPCs anyway).
    MongoDB Atlas, with a dedicated `monolith-db` database on the same
    cluster as every microservice's own `<service>-service-db`.
  - An Elastic IP was allocated for a stable public address; the
    security group is scoped to SSH (restricted to the operator's IP),
    HTTP, and port 5000.
- **Bug 1 - cookie authentication failing (401 immediately after
  login):** `secure: process.env.NODE_ENV === "production"` correctly
  evaluated to `true` (`NODE_ENV=production` was set), but the instance
  serves plain HTTP with no TLS configured, so browsers silently refused
  to store `Secure` cookies over an insecure connection. Fixed by
  setting `secure: false` across all three cookie-setting blocks in
  `auth.controller.js`, with an inline comment marking this as a
  deliberate exception for this HTTP-only demo/benchmarking environment,
  not a production security posture.
- **Bug 2 - frontend static file serving 404 on every route** despite a
  valid `frontend/dist/` build existing: `server.js`'s
  `express.static()` and catch-all route are gated behind
  `if (process.env.NODE_ENV === "production")`, which wasn't set in
  `.env` on this fresh instance. Fixed by adding `NODE_ENV=production`.
- **Bug 3 - Stripe.js failed to initialize**
  (`IntegrationError: Missing value for Stripe(): apiKey should be a
  string`): `frontend/.env` (containing `VITE_STRIPE_PUBLISHABLE_KEY`)
  didn't exist on this fresh clone, and Vite bakes env vars in at build
  time, not runtime. Fixed by creating `frontend/.env` with the
  publishable key and rebuilding.
- **Bug 4 - Stripe checkout success/cancel redirects failed with
  `ERR_CONNECTION_REFUSED`:** `CLIENT_URL` in `.env` was set to
  `http://13.38.201.124` with no port, but nothing listens on port 80 on
  this instance (no reverse proxy configured). Fixed by correcting
  `CLIENT_URL` to include `:5000`.
- **Verification:** full purchase flow confirmed working end-to-end -
  login, product browsing (seeded via the existing
  `scripts/seed-products.js`, the same product catalog used throughout
  this project, for consistent cross-architecture benchmarking), cart,
  the $200+ coupon reward system (a `GIFT` coupon auto-generated and
  successfully applied at checkout), Stripe test-mode payment, the
  purchase success page, and admin role/panel access (role promoted
  directly via a MongoDB update, since this codebase has no admin
  signup flow).
- **Stage:** Monolith (EC2 deployment infrastructure; the four bugs
  above are deployment/environment issues specific to a fresh HTTP-only
  EC2 instance, not defects in the `v1.4-monolith-baseline` code itself).

## [2026-07-23] Baseline's cart-service running on an ephemeral public IP, not a static Elastic IP - quota increase pending

- **Context:** while tagging and assigning Elastic IPs to Baseline
  Microservices' five EC2 instances (product/user/cart/coupon/order,
  one per service, in `eu-west-3`), the account's EC2-VPC Elastic IP
  quota (5, the AWS default) was exhausted after allocating 4 of the 5
  needed - the Monolith's own EC2 instance (see the deployment entry
  above) already held one of the five, leaving no headroom for the
  fifth Baseline service.
- **Current state:** product-service, user-service, coupon-service, and
  order-service each have a proper static Elastic IP. **cart-service is
  running on an auto-assigned ephemeral public IP (`13.37.226.159`)**
  instead - reachable right now, but this address is **not stable** and
  will change if the instance is stopped and restarted.
- **Decision:** requested a quota increase to 10 rather than releasing
  the Monolith's existing EIP or leaving cart-service permanently
  IP-less - keeps every architecture's EC2 footprint independent, with
  headroom for whichever stage needs a EIP next. Submitted via
  `aws service-quotas request-service-quota-increase` (quota code
  `L-0263D0A3`, verified against `list-service-quotas` before
  submitting), **request ID `18f97487beb9452dae60babb003aac0frhE5kiOa`**,
  submitted 2026-07-23, status PENDING at time of writing.
- **Action item:** once the quota increase is approved, allocate and
  associate a proper Elastic IP for cart-service, replacing the
  ephemeral one. This matters specifically because the plan is to
  stop/redeploy all three architectures between now and the faculty and
  final defenses - an ephemeral IP that changes on every restart would
  silently break anything pointing at cart-service's current address
  (e.g. `CART_SERVICE_URL` in Order Service's config) between now and
  then.
- **Stage:** Baseline Microservices (EC2 deployment infrastructure).

## [2026-07-23] Baseline Microservices deployed across 5 separate EC2 instances, one per service - .env topology decisions

- **Decision:** each of the five Baseline services (product/user/cart/
  coupon/order) runs on its own dedicated EC2 instance (`t3.micro`),
  rather than sharing a single host the way `docker-compose.yml`'s local
  dev stack does. Each instance runs its own local `redis-server`
  (installed and enabled during the earlier environment setup) and each
  Mongo-backed service connects to its own dedicated Atlas database
  (`baseline-<service>-service-db`, on the same cluster as every other
  stage's databases in this project).
- **Redis topology - intentional change, not a regression:** the
  `.env.example` files' comments describe a single shared physical
  Redis instance (Product Service's `featured_products` cache, User
  Service's refresh tokens, and Cart Service's cart hashes, isolated
  only by key prefix - see the Cart-as-Redis-Hash entry above). Since
  each service now runs on a physically separate EC2 instance, each gets
  its **own separate local Redis** instead - there is no shared Redis to
  point at anymore. This is arguably **more correct microservices
  isolation** than the original local-dev design (no cross-service key-
  prefix collision risk, no single Redis instance as a shared point of
  failure across three services), not a loss of functionality. Recorded
  here explicitly so this divergence from the `.env.example` comments
  isn't later mistaken for a deployment bug.
- **Cross-service URLs use real Elastic IPs, not `localhost`:**
  `PRODUCT_SERVICE_URL`, `CART_SERVICE_URL`, `COUPON_SERVICE_URL`, and
  `USER_SERVICE_URL` each point at the relevant instance's real public
  Elastic IP and port (e.g. Cart Service's `PRODUCT_SERVICE_URL=
  http://15.188.19.182:5001`), since these services are now on
  physically separate machines rather than one shared host or Docker
  network.
- **`CLIENT_URL` set to `http://localhost:5173`** across all five
  services, as a temporary stopgap - `frontend-baseline` has no
  deployment URL yet. Same pattern as Enhanced Microservices' own
  `CLIENT_URL` stopgap earlier this session. **Action item:** update all
  five once `frontend-baseline` has a real deployment URL.
- **Shared secrets** (`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`,
  `INTERNAL_SERVICE_KEY`) are kept byte-identical across all five
  services' `.env` files, as required for stateless JWT verification and
  the shared-secret-gated service-to-service calls - consistent with
  every other stage's auth design already on record in this file.
- **Action item:** `order-service`'s `STRIPE_SECRET_KEY` is still the
  `sk_test_replace-me` placeholder - pending manual completion directly
  on the instance, not pasted through chat.
- **Stage:** Baseline Microservices (EC2 deployment infrastructure).

## [2026-07-23] All 5 Baseline services started via pm2 - clean startup confirmed across the board

- **Decision/note:** starting each service required running
  `npm ci --omit=dev` first, on every one of the five instances -
  `node_modules` didn't exist yet, since the earlier environment setup
  only did `git clone` + `git checkout baseline-microservices`, with no
  dependency install step. Worth recording explicitly for anyone
  following this deployment process later, since it's an easy step to
  forget between "clone the repo" and "start the service."
- **Verification:** all five started cleanly via
  `pm2 start src/server.js --name <service>`, confirmed `online` in
  `pm2` status, with clean logs and no errors:
  - product-service, user-service, coupon-service, order-service each
    logged `MongoDB connected: ...` against their respective Atlas
    shard, as expected.
  - cart-service logged no MongoDB connection line - expected and
    correct, since Cart Service is Redis-only by design (see the
    Cart-as-Redis-Hash entry above), not a missing/failed connection.
- **Action item:** `order-service`'s `STRIPE_SECRET_KEY` still needs
  verification via an actual checkout test - clean pm2 startup alone
  doesn't exercise this value, since it's only read when a checkout is
  initiated, not at server start.
- **Stage:** Baseline Microservices (EC2 deployment infrastructure).

## [2026-07-23] Baseline-native seed script: services/product-service/scripts/seed-products.js

- **Decision:** created a Baseline-native seed script at
  `services/product-service/scripts/seed-products.js`, adapted from the
  Monolith's `scripts/seed-products.js`. The original imported
  `connectDB`/`cloudinary`/`Product` from `../backend/lib/db.js`,
  `../backend/lib/cloudinary.js`, and `../backend/models/product.model.js`
  - reaching into the Monolith's own internals from a Baseline context.
  The adapted version imports these from `product-service`'s own
  `src/lib/db.js`, `src/lib/cloudinary.js`, and `src/models/product.model.js`
  instead, and loads `services/product-service/.env` rather than the
  repo root's. Keeps Baseline Microservices architecturally
  self-contained - seeding its own database no longer depends on the
  Monolith's code existing or being wired correctly.
- **Import-order hazard found and worked around:** `src/lib/cloudinary.js`
  calls `cloudinary.config(...)` at module-load time, using its own bare
  `dotenv.config()` (no path argument). Since ES module imports always
  execute before any code below them in the importing file, the script's
  own path-specific `dotenv.config({ path: "../.env" })` line runs *after*
  `cloudinary.config()` has already fired - too late to affect it if the
  process's working directory doesn't already resolve to
  `services/product-service`. The fix is invocation, not code: the
  script must be run **from `services/product-service`'s own directory**
  (`cd services/product-service && node scripts/seed-products.js`), so
  that `cloudinary.js`'s bare `dotenv.config()` finds the correct `.env`
  directly at import time - the same way the real service itself is
  always started. Documented directly in the script's header comment so
  this isn't rediscovered the hard way next time.
- **Verification:** ran successfully from `product-service`'s EC2
  instance - `MongoDB connected: ac-l11pxv5-shard-00-02.2cibdjn.mongodb.net`,
  **27 created, 0 skipped**, matching the same per-category distribution
  used throughout this project (cement/pipes/plank/rods/roofing-sheet/
  wall-paints: 4 each, water-tank: 3), each with a real Cloudinary
  upload. Independently confirmed live via the running service's own
  API (`/api/products/featured`, `/api/products/category/cement`),
  matching the seed script's own report exactly.
- **Stage:** Baseline Microservices.

## [2026-07-23] Backend smoke test finds cookie-based auth cannot work cross-service on Baseline's current EC2 topology

- **Finding:** a curl-based smoke test (signup + login on user-service,
  then an authenticated request to cart-service using the saved cookie
  jar) confirmed that cookie-based authentication **cannot span
  services** in Baseline's current deployment (five separate EC2
  instances, no shared domain, no gateway). Cookies set by user-service
  are host-only (no `Domain` attribute), scoped to its specific IP
  (`35.181.186.152`) - confirmed directly from curl's own cookie jar,
  which shows `#HttpOnly_35.181.186.152` scoping the `accessToken`/
  `refreshToken` entries. They were never sent to cart-service's
  different IP (`13.37.226.159`), which correctly returned
  `401 Unauthorized - No access token provided`.
- **Not a SameSite/Secure configuration bug**, unlike the Monolith's
  HTTP-only cookie issue above. Changing `sameSite` to `"none"` would
  not fix this - the cookie's `Domain` never matches cart-service's
  host in the first place, so it's never even a candidate to be sent,
  regardless of `SameSite`/`Secure` values. This is an inherent
  architectural property of the current topology: with no unifying
  origin, cookie-based auth fundamentally cannot span services.
- **Why this was never caught in local dev:** cookies are scoped by
  hostname only, not by port. When all five services ran on `localhost`
  at different ports (the original local-dev/Docker Compose setup), a
  cookie set by user-service at `localhost:5002` was still sent to
  cart-service at `localhost:5003`, since both share the same hostname.
  The limitation was invisible until deployment put each service on a
  genuinely different host.
- **Confirmed not a known/worked-around limitation:** grepped
  `Authorization`/`Bearer` across all five services'
  `src/middleware/auth.middleware.js` files - zero matches; every one
  reads `req.cookies.accessToken` only, with no header-based fallback.
  `frontend-baseline/src/lib/api.js` relies purely on `withCredentials:
  true` (cookies), with no `Authorization` header logic anywhere in
  `frontend-baseline/src`. No prior entry in this file addresses this
  specific cross-host cookie-scoping issue (the closest, the 2026-07-16
  User/Auth Service extraction entry, covers stateless *token
  verification* design - a different concern from whether the cookie
  can physically reach the service at all).
- **Significance:** a citable, demonstrable finding supporting this
  dissertation's core thesis - this is precisely the kind of
  cross-cutting concern (shared authentication across services) that
  motivates Enhanced Microservices' API Gateway architecture, which
  solves this exact problem via a single origin plus
  `SameSite=None`/`Secure` cookies (see the cross-origin cookie fix
  entry above). Baseline's inability to do this cleanly, without a
  Gateway, is itself part of the Baseline-vs-Enhanced comparison this
  project is built around.
- **Action item:** decide how (or whether) to work around this for
  Baseline's remaining testing - e.g. a temporary shared-domain/DNS
  setup, switching to `Authorization: Bearer` token forwarding for
  Baseline specifically, or documenting cross-service authenticated
  flows as a known, out-of-scope limitation of this stage's
  no-Gateway topology.
- **Stage:** Baseline Microservices.

## [date not precisely recorded, prior to 2026-07-25] First occurrence: "primary marked stale" MongoDB connection error, product-service, following the Atlas M10 tier upgrade
- **Context:** shortly after MongoDB Atlas was upgraded to the M10 tier
  (to resolve connection-limit exhaustion during Enhanced load testing),
  product-service threw a MongoDB error along the lines of "primary
  marked stale due to electionId/setVersion mismatch," surfacing as a
  failed request. This entry is being logged retroactively on
  2026-07-27, alongside a second occurrence (see entry below) - the
  exact original date and full symptom detail were not recorded at the
  time and are reconstructed here from memory rather than a contemporary
  log.
- **Fix:** resolved via a process restart (pm2) at the time.
- **Significance:** at the time this looked like a one-off, possibly
  M10-migration-related hiccup. See the entry below for why a second,
  later occurrence changes that interpretation.
- **Stage:** cross-cutting (MongoDB Atlas is shared across all three
  architectures).

## [2026-07-27] Second occurrence: "primary marked stale" MongoDB connection error, Baseline's user-service, 2 days uptime - suggests a recurring long-lived-connection issue, not an M10-migration one-off
- **Context:** discovered during this session's login troubleshooting -
  Baseline's user-service (up ~2 days, no known Atlas-side change in
  that window) hit the same "primary marked stale due to
  electionId/setVersion mismatch" error as the product-service incident
  above. It went uncaught until a fresh login attempt failed with a 500
  error - i.e. the stale connection sat unused and undetected until
  something actually tried to use it.
- **Decision:** treat this as the second occurrence of the same
  underlying issue, not an isolated bug. Since this instance has been
  running for 2 days with no known Atlas-side event in that window, the
  M10 upgrade itself can be ruled out as the specific cause - the
  pattern instead points to long-lived Node.js/Mongoose connections to
  Atlas going stale over time, most likely due to periodic Atlas-side
  maintenance/failover events that are invisible to the application
  until the connection is actually used again.
- **Fix:** `pm2 restart` on all 4 MongoDB-connected Baseline services,
  as a precaution (not just user-service), since any of them could be
  holding an equally stale connection without having hit it yet.
- **Action item / operational note:** in a production system, this
  would warrant either periodic proactive connection health
  checks/reconnection logic, or accepting occasional manual restarts as
  a known operational characteristic of long-running Node.js services
  against MongoDB Atlas. Worth including as a limitation/operational
  consideration in the dissertation's discussion of production-
  readiness - a real cloud-native gotcha not specific to any one of the
  three architectures being compared.
- **Stage:** cross-cutting (applies to all three architectures' Atlas
  connections; this occurrence happened on Baseline specifically, but
  the underlying cause is not Baseline-specific).

## [2026-07-27] Enhanced's residual connection-reset failures under concurrent signup load, after pod resource resizing - Gateway/NLB/node-capacity ruled out, points to the same per-process connection-handling limitation as Baseline's
- **Context:** after resizing product-service, order-service, AND
  user-service to 500m/1000m CPU (see prior entries), re-ran
  `full-journey.js` against Enhanced (50 VUs, 3 minutes): 97.81%
  success (up from 89.85% before the user-service resize), p95
  358.87ms (down from 4.51s) - a large improvement, but a residual
  2.18% failure rate remained (213/9,732 checks failed), concentrated
  on the same pattern as before: signup (44 failures), add to cart
  (44), view cart (44), checkout session (80) - all
  authenticated/write operations - while featured/category
  (unauthenticated reads) stayed at 99-100% success.
- **Three potential causes investigated, each ruled out with direct
  evidence (independently re-verified live in this session, not just
  taken on report):**
  1. **Node/cluster capacity** - `kubectl top nodes` shows ~1% actual
     CPU usage across all 12 nodes; `kubectl describe nodes`'
     Allocated-resources budget mostly sits at 7-51% (one node at
     82%), all with substantial spare headroom. Ruled out.
  2. **API Gateway errors** - CloudWatch `5xxError` for the API
     (`7iuv0462q5`) shows zero datapoints over the last 48 hours.
     Ruled out.
  3. **NLB target health / TCP resets** - both `tg-user-service`
     targets confirmed `healthy`. CloudWatch `TCP_Client_Reset_Count`
     for `buildmart-internal-nlb` does have datapoints (48 over 48
     hours, one per hour - not literally zero datapoints as first
     described), but every single one has `Sum: 0.0` - i.e. the metric
     is being published continuously and consistently shows no resets,
     which supports the same conclusion the "zero datapoints" framing
     was reaching for, just described more precisely here. Ruled out.
- **Conclusion:** the residual connection resets are not occurring at
  the Gateway, NLB, or node-capacity level - they occur deeper in the
  chain, most likely at each individual pod's own Node.js HTTP server
  connection-accept layer, the same fundamental mechanism identified as
  the root cause of Baseline's connection-reset failures (see entry
  above). Enhanced's 2-replica Kubernetes Service distributes load
  across 2 pods rather than Baseline's single process, which explains
  why Enhanced's failure rate (2.18%) is meaningfully lower than
  Baseline's (7.66%) under the same load pattern - but does not
  eliminate the underlying single-process-per-pod connection-handling
  limitation, since each individual pod remains a single-threaded
  Node.js process with its own finite connection-accept backlog.
  Horizontal replication mitigates but does not structurally eliminate
  this class of bottleneck; that would require either more replicas,
  or a multi-worker-process runtime configuration within each pod
  (e.g. Node.js's `cluster` module), neither of which was implemented
  in this study.
- **Significance:** this is treated as a final, genuine architectural
  finding for Enhanced Microservices under this specific load pattern
  (bursty concurrent authentication/write requests), not a
  misconfiguration to be further corrected - directly relevant to
  Objective 3's resilience-under-load comparison, and a natural
  counterpart to the Baseline finding above: the same root mechanism
  manifests at different severities depending on how many processes
  share the load.
- **Stage:** Enhanced Microservices.

## [2026-07-28] bcryptjs replaced with native bcrypt in Enhanced's user-service - Enhanced-only fix, introduces a named cross-architecture confound
- **Decision:** replaced `bcryptjs` with native `bcrypt` (upgraded to
  6.0.0 during implementation - see below) in Enhanced Microservices'
  user-service only. This directly targets the root cause identified in
  the full-journey investigation above: bcryptjs's pure-JS hashing blocks
  Node's single event loop under concurrent signup load, causing
  connection resets.
- **Scope, deliberately limited to Enhanced:** Monolith (`backend/`) and
  Baseline (`services/user-service/` on `baseline-microservices`) are
  NOT changed. This is a deliberate methodological choice, not an
  oversight - the fix is being evaluated in isolation on the one
  architecture where the investigation was performed, rather than
  silently applied everywhere before its effect is actually measured.
- **Version note:** the originally planned `bcrypt@^5.1.1` was rejected
  after `npm audit` found 7 vulnerabilities (6 high, 1 critical) in its
  `@mapbox/node-pre-gyp`/`tar` install-time toolchain (not runtime code).
  Upgraded to `bcrypt@6.0.0`, which introduces zero new vulnerabilities
  in the production (`--omit=dev`) install. Verified before deployment:
  native binary loads with no source compilation required on
  `node:20-alpine`, and a functional hash/compare round-trip succeeds.
- **Named confound - stated limitation for cross-architecture
  comparison:** because this fix exists ONLY on Enhanced, any
  improvement in Enhanced's full-journey auth-success rate measured
  after this change is **partly attributable to this library swap, not
  purely to architecture**. When Enhanced's auth success rate is
  compared against Baseline's (still on `bcryptjs`) or Monolith's, this
  must be stated as a limitation, not presented as a clean
  architecture-only comparison - Baseline and Monolith retain the
  original bcryptjs behavior and would likely show the same underlying
  event-loop-blocking issue if tested under equivalent concurrent
  signup load.
- **Stage:** Enhanced Microservices only (explicitly not cross-cutting -
  see confound above for why this must not be generalized to the other
  two architectures without being named as such).

## [2026-07-29] bcrypt fix validation: initial local re-run discarded (execution-location confound), two corrected re-runs from buildmart-k6-runner show a real, corroborated improvement
- **Context:** re-ran `full-journey.js` (50 VUs, 3 min, ARCH=enhanced) to
  measure the effect of the bcryptjs->bcrypt fix logged above. A first
  attempt was run directly from the local development machine, not from
  an in-region EC2 instance - a direct violation of this project's own
  established methodology (see the earlier "in-region EC2 runner" PLANNED
  entry), which exists specifically to avoid local/residential network
  variance as a confound.
- **Discarded data point:** that local run recorded 97.46% success
  (7,768/7,970), with several `dial tcp ...: connectex` connection-level
  failures against both `/api/auth/signup` and `/api/products/featured`,
  and individual iteration durations as high as 27-49s (vs. a normal
  ~6-7s) - all consistent with local network instability, not the
  application or the bcrypt fix. This result is recorded here explicitly
  as a **discarded, non-comparable data point**, not silently dropped
  from the project's history: it should not be cited as evidence about
  the bcrypt fix's effect either way.
- **Corrected re-run (Run 2, this session):** SSH access to
  `buildmart-k6-runner` (`i-0d3ddc1f0a6f315ac`) was restored (same
  stale-security-group-IP pattern as prior instances this session -
  revoked the old rule, authorized the current IP, confirmed with a
  real SSH connection before proceeding). Confirmed the instance's
  checked-out `full-journey.js` was byte-identical to the current
  committed version (after fetching 6 commits it was behind) before
  making the same temporary `vus:20->50` edit used for this comparison,
  running the test, then reverting the
  edit immediately after.
- **Replica counts, recorded at time of test:** all 5 services confirmed
  at 2/2 (desired/ready) both immediately before and immediately after
  the run - no HPA scale event occurred during the test (`user-service`
  has no HPA at all, so it was structurally fixed at 2 replicas in both
  the original and this re-run regardless).
- **Result - a SECOND independent run was also captured** (run by the
  operator directly, not by this session, immediately after the first,
  same 50 VU/3 min conditions, same `buildmart-k6-runner` instance):
  | | Before (bcryptjs) | Run 2 (this session) | Run 3 (operator, independent) |
  |---|---|---|---|
  | Overall success | 97.81% (9,519/9,732) | 98.23% (9,712/9,886) | 98.46% (9,748/9,900) |
  | signup failure rate (per iteration) | 2.71% | 1.58% | 1.82% |
  | add to cart failure rate | 2.71% | 1.70% | 1.82% |
  | view cart failure rate | 2.71% | 1.76% | 1.94% |
  | checkout session failure rate | 4.93% | 5.15% | 3.64% |
  | Connection-level errors | - | none | none |
- **Combined result:** success rate improved from 97.81% to a range of
  98.23%-98.46% across two independent runs, mean ~98.3% - a real,
  corroborated improvement, not a one-off.
- **Interpretation:** signup, add-to-cart, and view-cart - the checks
  that cascade from user-service's signup path - improved meaningfully
  and consistently in BOTH runs (roughly 1 percentage point each). This
  internal pattern, replicated independently, is corroborating evidence
  that the improvement is real and specifically attributable to the
  bcrypt fix's targeted mechanism (reduced event-loop blocking on
  user-service), not one-off run-to-run noise.
- **Checkout session - flagged as unexplained variance, not smoothed
  over:** relative to the 4.93% baseline, Run 2 moved this check's
  failure rate *up* (5.15%) while Run 3 moved it *down* (3.64%) - the
  two post-fix runs disagree with each other about the direction of
  change on this specific check, and the 1.51pp spread between them is
  larger than the ~1pp improvement seen on the checks the fix should
  plausibly affect. Checkout-session depends on order-service/
  coupon-service, not user-service's password hashing, so under the
  fix's own mechanism neither run's result is obviously "expected" -
  this is left as an open question rather than asserted as flat/noise
  or explained away in either direction. Worth investigating further
  if checkout-session's behavior becomes relevant to another finding.
- **Anomaly check:** zero connection-level warnings/errors in either
  post-fix run's log (vs. multiple in the discarded local run). Run 2's
  max `iteration_duration` was 7.63s, no outliers. All of Run 2's 26
  signup failures were individually confirmed as genuine `503 Service
  Unavailable` responses, not network artifacts. Run 3's raw log was
  not independently inspected by this session (reported by the
  operator).
- **Stage:** Enhanced Microservices only (same scope caveat as the fix
  itself - this validates the fix's effect on Enhanced specifically, not
  a cross-architecture claim).

## [2026-07-29] Planned: 12 cloud-native capability experiments, scoped independently of the ongoing user-service 503 investigation

- **Decision:** paused the user-service 503 root-cause investigation
  (API Gateway access logging + Autocannon sweep, still pending) to run
  12 independent cloud-native capability experiments in parallel, since
  none of them depend on that investigation's outcome - they exercise
  deployment mechanics, HPA, self-healing, load balancing, caching, CDN,
  and network isolation, not the signup/auth request path where the
  residual 503s live.
- **The 12 experiments, with the primary technology each demonstrates:**
  1. Zero-Downtime Deployment - Kubernetes Rolling Updates
  2. Deployment Automation Time - GitHub Actions CI/CD
  3. Autoscaling Responsiveness - Kubernetes HPA
  4. Self-Healing Time - Kubernetes Recovery
  5. Mean Time To Recovery - Fault Recovery
  6. Load Balancing Effectiveness - ALB/Kubernetes Service
  7. Resource Elasticity - Auto Scaling
  8. Cache Effectiveness - Redis/ElastiCache
  9. CloudFront Geographic Performance - CDN
  10. Fault Isolation - Microservice Independence
  11. Network Isolation and Security Effectiveness - VPC/Subnets/SGs
  12. Network Communication Efficiency - Private Networking
- **Deliberate test-design constraint:** experiments #1, #3, #5, and #7
  use `read-heavy.js` as the load generator, not `full-journey.js` -
  full-journey.js includes signup, which carries the known ~1.5-2%
  residual failure rate from the still-open 503 investigation. Reusing
  it here would risk misattributing that known, unrelated issue to
  whatever each of these experiments is actually trying to measure
  (e.g. a dip during a rolling-update test being wrongly blamed on the
  deployment mechanism itself). This mirrors the same
  confound-avoidance discipline already established elsewhere in this
  project (e.g. keeping the four performance optimizations applied
  uniformly across stages, isolating the bcrypt fix to one architecture
  before drawing conclusions).
- **Execution order, by shared setup cost rather than by number:**
  cheap/no-load-generation experiments first (#6, #11, #12), then
  cache/CDN (#8, #9), then the k6-driven batch requiring
  buildmart-k6-runner plus parallel kubectl watching (#1, #3, #4, #5,
  #7), then the two requiring either historical CI data or a deliberate
  outage (#2, #10) last.
- **Known prerequisite:** #6 (Load Balancing Effectiveness) requires a
  small, temporary code change first - a response header exposing
  `process.env.HOSTNAME` on one lightweight endpoint, so individual
  responses can be attributed to a specific pod. This is the only
  experiment on this list requiring an application change; all others
  are read-only against the already-live deployment.
- **Status:** PLANNED - nothing in this list has been executed yet.
  The 503 investigation (API Gateway access logging + Autocannon sweep)
  remains open and will resume once this batch is complete or as
  capacity allows, since the two efforts don't block each other.
- **Stage:** Enhanced Microservices.

## [2026-07-29] Finalized sample-size methodology and Enhanced-only scoping for the 12 cloud-native capability experiments

- **Recommended runs per experiment:**

  | # | Experiment | Recommended runs |
  |---|---|---|
  | 1 | Zero-Downtime Deployment | 10 deployments |
  | 2 | Deployment Automation Time | 10 pipeline executions |
  | 3 | Autoscaling Responsiveness | 5-10 load tests |
  | 4 | Self-Healing Time | 10 pod failures |
  | 5 | Mean Time To Recovery | 10 failure-recovery cycles |
  | 6 | Load Balancing Effectiveness | 3-5 load tests, >=200 requests each |
  | 7 | Resource Elasticity | 5 distinct load profiles |
  | 8 | Cache Effectiveness | 10 cold-cache + 10 warm-cache requests |
  | 9 | CloudFront Geographic Performance | 30-50 requests per region (6 regions, 300 total) |
  | 10 | Fault Isolation | 10 failure injections |
  | 11 | Network Isolation/Security | 20 connection attempts per scenario (unauthorized / authorized / internet) |
  | 12 | Network Communication Efficiency | 100-1,000 request pairs, internal vs external |

- **Reporting convention:** all results will be reported as mean +/-
  standard deviation, not single-run figures - matching this project's
  existing discipline, not a new standard invented for this batch. Prior
  example already on record: the two independently-run bcrypt validation
  tests (98.23% and 98.46%, reported as a range/mean rather than citing
  either run alone - see the bcrypt fix validation entry above).
- **Enhanced-only scoping, decided explicitly:** experiments #1, #2, #4,
  and #5 (deployment automation, self-healing, MTTR) will be run on
  Enhanced only. Baseline and Monolith have no equivalent orchestrated
  mechanism to measure - no automated rollout, no automatic pod
  replacement. Rather than construct an artificial equivalent (e.g.
  manually timing a `pm2 restart` and labeling it "Baseline MTTR"), the
  absence of these capabilities on Baseline/Monolith will be reported
  directly as part of the finding itself. This is consistent with how
  this project already treats Baseline's lack of an API Gateway (CORS
  handling, shared-secret inter-service trust) as a named architectural
  contrast rather than something to paper over with a substitute
  measurement.
- **Status:** PLANNED - methodology finalized, no experiments executed
  yet.
- **Stage:** Enhanced Microservices.

## [2026-07-29] PLANNED: Experiment #11 - Network Isolation and Security Effectiveness

- **Decision:** starting experiment #11 from the 12-experiment plan
  above. Will enumerate the intended public/private boundary (API
  Gateway, CloudFront, and SSH bastion/runner access deliberately
  public; pod ClusterIPs, internal Service DNS, and the NLB's internal
  listener deliberately private), then run 20-attempt connection tests
  from three vantage points (public internet, an unauthorized-but-
  in-VPC point if one exists, and the authorized Gateway path), and
  separately audit every security group attached to the EKS node group,
  the NLB, and `buildmart-k6-runner` for overly permissive (0.0.0.0/0)
  or stale rules.
- **Status:** PLANNED - nothing executed yet.
- **Stage:** Enhanced Microservices.

## [2026-07-29] Experiment #11 results: Network Isolation and Security Effectiveness

- **Scope enumerated:** deliberately public — API Gateway, CloudFront,
  SSH access to `buildmart-k6-runner`/Baseline hosts (IP-restricted).
  Deliberately private — pod ClusterIPs, internal Service DNS, the
  internal NLB's listener, and the NodePort range (30001-30005) despite
  the underlying EKS nodes having public IPs.

- **Scenario 1 - public internet -> internal-only endpoints (20 attempts):**
  Cycled across 5 EKS node public IPs on port 30002 (user-service
  NodePort). **Result: 0/20 connected**, all `AbortError` (timeout).
  Supplementary single-attempt checks against the pod IP directly and
  the internal NLB's publicly-resolvable-but-private-IP DNS name also
  timed out (`curl` exit 28). Matches the node security group
  (`sg-082af3989363c59a3`) restricting 30001-30005 to `192.168.0.0/16`
  (VPC CIDR only), not `0.0.0.0/0`.

- **Scenario 2 - unauthorized-but-in-VPC vantage point (20 attempts, as
  originally scoped):** Not executed, and not treated as an incomplete
  result. Investigation found there is no existing instance positioned
  as "in-VPC but unauthorized" - the EKS VPC (`vpc-012837d750a23a6e3`)
  contains only the 12 worker nodes, all sharing one identical security
  group, and `buildmart-k6-runner` sits in an entirely separate VPC
  (`vpc-0c730dbccd8daa0ef`, Baseline's) with **zero VPC peering
  connections between the two** (confirmed via
  `aws ec2 describe-vpc-peering-connections`, empty result). Rather than
  provision a new throwaway EC2 instance purely to reproduce the
  originally-scoped SG-based test, this is reported as the finding
  itself: Enhanced's network isolation is stronger than an SG-rule test
  would have shown, because no routable path exists between an
  arbitrary in-VPC-adjacent host and the EKS backend at all - it's not
  that a request is denied, there's nowhere for it to even be routed.
  A security-group misconfiguration cannot expose these backends to a
  differently-scoped neighbor, because there is no shared network to
  misconfigure across.

- **Scenario 3 - authorized path via API Gateway (20 attempts):** All
  20 hit `GET /api/products/featured` through
  `https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com`. **Result:
  20/20 HTTP 200.**

- **Pass/fail summary:**

  | Scenario | Attempts | Result |
  |---|---|---|
  | 1. Public internet -> internal-only endpoint | 20 | 0/20 (expected) |
  | 2. Unauthorized-but-in-VPC | n/a | Not testable - no such vantage point exists; reported as a stronger isolation finding (VPC-level non-routability), not a gap |
  | 3. Authorized path (Gateway -> VPC Link -> backend) | 20 | 20/20 (expected) |

- **Security group audit:**
  - `sg-082af3989363c59a3` (EKS node group): NodePort range correctly
    restricted to the VPC CIDR. No `0.0.0.0/0` on any application port.
    Clean.
  - `sg-0be73acbe681a3c2e` (EKS cluster cross-account ENI SG): empty
    ingress rule set. No findings.
  - Internal NLB (`buildmart-internal-nlb`): `Scheme: internal`, no
    directly-attached security group. Consistent with the non-public
    design.
  - EKS control-plane API endpoint: `EndpointPublicAccess: true`,
    `PublicAccessCidrs: ["0.0.0.0/0"]`, `EndpointPrivateAccess: false`.
    A real `0.0.0.0/0` finding, though a common and accepted EKS
    default - the control plane relies on IAM authentication rather
    than network-level restriction for this endpoint. Named here per
    the audit's own "flag anything overly permissive" scope, not
    treated as equivalent in severity to the finding below.
  - **`sg-08b98e852875628dc` (shared by Baseline's 5 EC2 instances and
    `buildmart-k6-runner`) - the most significant finding of this
    experiment:** TCP 5001-5005 (Baseline's product/user/cart/coupon/
    order services) open to `0.0.0.0/0`. This is a **structural
    limitation of Baseline's architecture, not a misconfiguration left
    unfixed for convenience.** Baseline has no API Gateway by design
    (Stage 2's deliberate scope, per CLAUDE.md), so
    `frontend-baseline`'s browser JS calls each service's port directly
    - confirmed via `frontend-baseline/.env.example`:
    `VITE_PRODUCT_SERVICE_URL=http://<host>:5001` etc., "since there is
    no API Gateway yet." That means any real visitor's browser, from
    any IP, must be able to reach these five ports for the deployed
    Baseline app to function at all. A CIDR restriction was evaluated
    as a real remediation and explicitly rejected (not merely deferred)
    for this reason: it would break public accessibility for genuine
    visitors, defeating both the live demo and the honesty of the
    Baseline-vs-Enhanced comparison this project is built around. There
    is no way to move this trust boundary inward without adding the
    exact capability Enhanced's Gateway provides - which is precisely
    why Enhanced has one and Baseline doesn't yet. The security group
    rule is therefore left as `0.0.0.0/0` on 5001-5005, by deliberate
    decision, with this reasoning on record. Contrast with Enhanced:
    Enhanced's equivalent backends are unreachable from the public
    internet by two independent layers (the NodePort SG rule from
    Scenario 1, and VPC-level non-routability from Scenario 2's
    finding), specifically because the Gateway removes the need for any
    client to reach a backend port directly. This is a direct,
    structural Baseline-vs-Enhanced security contrast, not a stale-rule
    cleanup item like the SSH rules fixed earlier this session.
- **Status:** COMPLETE. Scenario 2 executed as a topology finding
  rather than a live connection test, and the Baseline SG rule
  evaluated and deliberately left unchanged, both per explicit decision
  - see above.
- **Stage:** Enhanced Microservices (primary finding), with a directly
  comparative Baseline Microservices security contrast.

## [2026-07-29] PLANNED: Experiment #12 - Network Communication Efficiency

- **Decision:** starting experiment #12 from the 12-experiment plan
  above. Will measure a real, already-instrumented internal dependency
  - Cart Service's `getProductsByIds` call
  (`POST /api/products/batch`, `{ids: [...]}`) to Product Service -
  rather than a synthetic call built just for this test. Will compare
  two paths for the identical request shape and payload: (a) internal,
  from inside a cart-service pod over Kubernetes Service DNS
  (`http://product-service:5001`), and (b) external-equivalent,
  through the public API Gateway
  (`https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/products/batch`,
  routed via the Gateway's `ANY /api/products/{proxy+}` route and VPC
  Link). N=100 minimum per path, per the plan's low end, extending
  toward 500-1000 if session time allows. Will report p50/p95/p99 and
  standard deviation for both distributions (not just means), compute
  the internal/external ratio, and treat the consistency claim
  (internal path lower variance, not just lower latency) as something
  requiring its own number rather than an assertion. Explicitly framed
  as the performance side of the same VPC-private architectural fact
  experiment #11 already established on the security side - not an
  unrelated new finding.
- **Status:** PLANNED - nothing executed yet.
- **Stage:** Enhanced Microservices.

## [2026-07-29] Experiment #12 results: Network Communication Efficiency

- **Call measured:** Cart Service's real `getProductsByIds` dependency -
  `POST /api/products/batch`, `{ids: [...]}` (5 real product IDs from
  the live catalog), against Product Service. Not a synthetic call.

- **Internal path** (N=500, sequential, from inside a cart-service pod,
  `http://product-service:5001`, Kubernetes Service DNS):
  mean=13.442ms, stddev=24.406ms, min=4.465ms, p50=6.741ms,
  p95=59.175ms, p99=92.637ms, max=397.057ms, 0 errors.

- **External-equivalent path** (N=500, sequential, executed from
  `buildmart-k6-runner` - same region, per this project's established
  execution-location discipline, not a local connection - via
  `https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/products/batch`,
  routed through the Gateway's `ANY /api/products/{proxy+}` -> VPC Link
  -> the same backend): mean=12.916ms, stddev=4.128ms, min=8.713ms,
  p50=11.575ms, p95=21.731ms, p99=31.638ms, max=36.676ms, 0 errors.
  Response caching was confirmed unavailable on this Gateway (HTTP API
  / protocol v2 does not support stage-level caching, unlike REST API
  v1), so these are genuine backend round-trips, not cached responses.

- **Ratios (internal / external):** p50 0.58x (internal faster),
  mean 1.04x (internal marginally slower), stddev 5.91x (internal far
  less consistent), p95 2.72x (internal worse), p99 2.93x (internal
  worse), max 10.8x (internal far worse).

- **Finding, reported as measured, not fitted to the hypothesis:** the
  internal path is faster at the median (6.7ms vs 11.6ms) but shows
  substantially higher variance and worse tail latency than the
  external Gateway-routed path - the opposite of "the internal path
  should be both faster and more consistent." Root-cause investigation
  (not full-depth, but reproduction-based rather than assumed):
  the internal path's raw samples show the first ~12-14 sequential
  requests alternating almost perfectly between ~90-100ms and ~10ms,
  settling afterward to a lower baseline with occasional recurring
  spikes. Tested whether this was cross-pod/cross-AZ round-robin
  (Product Service runs 2 replicas, one in the caller's own AZ
  eu-west-3c, one in eu-west-3b) by hitting each pod's IP directly,
  bypassing the Kubernetes Service entirely (N=50 each) - both pods
  individually reproduced the same alternating-then-settling shape,
  ruling out AZ/pod-placement as the cause. Most consistent with a
  per-TCP-connection warm-up effect (TCP slow-start / Nagle-delayed-ACK
  type interaction, or connection-pool warm-up in the Node fetch/undici
  client or on the Product Service side) rather than a network-path or
  placement issue - not confirmed to that level of specificity, and
  left as an open question rather than asserted as fact.

- **Tied to Experiment #11:** #11 established that this same VPC-private
  path is unreachable from the public internet by two independent
  layers (SG rule, VPC non-routability). #12 shows that this is a
  finding about network *isolation*, not a guarantee of network
  *performance consistency* - the two properties don't move together
  in this deployment. The internal path is faster in the typical case
  (lower median) but the external Gateway-routed path is the more
  latency-consistent one under this measurement, tail-latency included.
  This is reported as a genuine, unexpected nuance rather than smoothed
  into "internal is strictly better," consistent with this project's
  standing practice of naming unexplained variance directly (see the
  bcrypt-fix checkout-session cross-run disagreement entry).

- **Status:** COMPLETE. The connection-warm-up pattern behind the
  internal path's tail latency is a candidate for a future dedicated
  investigation, same category as the still-open user-service 503
  investigation - explicitly deferred, not dropped, and recorded here
  as a deliberate scope decision rather than an unnoticed gap.
- **Stage:** Enhanced Microservices.

## [2026-07-29] Experiment #12 extended: Baseline and Monolith Network Communication Efficiency (cross-references the Enhanced-only entry above)

- **Pre-registered checks (done before any load test, per this project's
  standing discipline):**
  - **Baseline VPC/subnet check:** Cart Service and Product Service EC2
    instances share one VPC (`vpc-0c730dbccd8daa0ef`) and subnet
    (`subnet-0ff155bc986c5a7a4`) - a private-IP path is technically
    routable. However, the actually-deployed `PRODUCT_SERVICE_URL` on
    the live cart-service instance is `http://15.188.19.182:5001` - the
    **public IP**, confirmed by reading the instance's real running
    config, not assumed. So Baseline's real traffic is public-IP-to-
    public-IP in production even though nothing at the network layer
    forces that - it's simply that Stage 2 never introduced an internal-
    DNS/private-IP convention (consistent with Experiment #11: no
    gateway, no VPC-private tier). Both the as-configured (public IP)
    and the technically-available-but-unused private-IP path were
    measured, rather than fabricating a single "internal" number.
  - **Monolith code-path check:** `getCartProducts`
    (`backend/controllers/cart.controller.js:16-33`) is a single
    in-process function doing one Mongoose call -
    `Product.find({_id:{$in:productIds}})` - with no separate service to
    call and no HTTP hop at all. Confirmed via `decision_log.md` that
    Monolith's MongoDB is Atlas (remote, cloud-hosted, same cluster as
    every other stage), not a local `mongod` - so this isn't a "zero
    network" operation, it's "one network hop to Atlas" versus Baseline/
    Enhanced's "one hop to a service, which itself hops to Atlas." The
    `Product.find(...)` call itself (not a full authenticated `/api/cart`
    request, which would bundle in session/auth overhead never measured
    on the other two architectures either) is the honest comparable
    unit, and is reported as categorically different from the other
    rows, not silently equalized.

- **Execution location, confirmed load-bearing for validity (same
  discipline as the bcrypt-fix k6 reruns):** both the Baseline and
  Monolith scripts were executed via SSH directly on the calling
  service's own EC2 instance - Baseline's `buildmart-baseline-cart-
  service` instance for the Baseline measurements, the Monolith's own
  `buildmart-monolith` instance for the Monolith measurement - not
  routed through `buildmart-k6-runner`, and not run from a local
  machine. This mirrors exactly how the Enhanced measurement was taken
  (from inside the calling cart-service pod), so all three architectures'
  numbers reflect the same thing: latency as experienced by the actual
  calling process, not by a third-party vantage point.

- **Combined results (N=500 each, all measured from inside the calling
  service's own compute - pod exec for Enhanced, SSH for Baseline/
  Monolith, matching this project's established execution-location
  discipline):**

  | Architecture | Path | What's measured | mean (ms) | stddev | p50 | p95 | p99 | max |
  |---|---|---|---|---|---|---|---|---|
  | Enhanced | Internal | HTTP, pod->pod, K8s Service DNS (VPC-private) | 13.442 | 24.406 | 6.741 | 59.175 | 92.637 | 397.057 |
  | Enhanced | External-equivalent | HTTP via public Gateway->VPC Link->same backend | 12.916 | 4.128 | 11.575 | 21.731 | 31.638 | 36.676 |
  | Baseline | As-configured | HTTP, EC2->EC2, public IP (what's actually deployed) | 5.528 | 4.316 | 4.744 | 8.560 | 14.361 | 93.629 |
  | Baseline | Same-subnet private IP | HTTP, EC2->EC2, private IP (routable but unused) | 4.812 | 1.746 | 4.228 | 7.586 | 14.263 | 18.826 |
  | Monolith | In-process lookup | Mongoose `Product.find`, no HTTP hop, Atlas round trip only - not a like-for-like row | 2.678 | 0.975 | 2.493 | 3.915 | 5.151 | 16.291 |

- **Finding, reported as measured:** Monolith's number is the floor for
  "one Atlas round trip with nothing else added" and is not evidence
  that Monolith's architecture is "faster at inter-service calls" - it
  has none. Among the three genuine cross-service HTTP measurements,
  **Baseline is both fastest and among the most consistent**, despite
  Experiment #11 already establishing Baseline has no gateway, no
  isolation tier, and backend ports open to `0.0.0.0/0`. Enhanced's own
  internal (VPC-private, more secure) path is slower at the tail and far
  more variable than Baseline's flat EC2-to-EC2 call. This reinforces
  the standalone Enhanced finding rather than complicating it: network
  isolation and network performance are separate, independently-moving
  properties in this deployment - Kubernetes' networking layer adds real
  overhead and variance versus simple EC2-to-EC2 networking, regardless
  of which side is more secure. Baseline's own public-vs-private-IP gap
  (mean +0.716ms, stddev +2.57x when using the public IP) additionally
  shows that Baseline's "no gateway" choice is not entirely free, just
  much cheaper than Enhanced's Kubernetes-networking overhead.
- **Status:** COMPLETE.
- **Stage:** cross-cutting (Monolith, Baseline Microservices, Enhanced
  Microservices) - see the Enhanced-only entry above for that
  architecture's original, unedited results and its own root-cause note
  on the internal path's connection-warm-up pattern (deferred, not
  dropped).

## [2026-07-29] PLANNED: Experiment #6 - Load Balancing Effectiveness

- **Decision:** starting experiment #6 from the 12-experiment plan,
  next per the plan's original execution order (cheap/no-load-generation
  items first; #11 and #12 already complete). Will add a temporary
  `X-Pod-Name` response header (`process.env.HOSTNAME`) to
  `GET /api/products/featured` (already used in prior experiments,
  lightweight and side-effect-free), verify `HOSTNAME` is actually
  populated in this cluster rather than assuming Kubernetes sets it,
  deploy via the same build/ECR-push/kubectl-set-image/rollout process
  already verified for the bcrypt fix, then send >=200 requests via the
  public API Gateway path both at idle and under a short k6 burst from
  `buildmart-k6-runner`, recording which pod answers each request. Will
  report per-pod distribution (counts and percentages) for both
  conditions explicitly, rather than only one, and revert the header
  change once data is collected.
- **Status:** PLANNED - nothing executed yet.
- **Stage:** Enhanced Microservices.

## [2026-07-29] Experiment #6 results: Load Balancing Effectiveness

- **Prerequisite:** added a temporary `X-Pod-Name` response header
  (`process.env.HOSTNAME`) to `GET /api/products/featured`. Verified
  `HOSTNAME` is actually populated with the pod's own name in this
  cluster before relying on it (`kubectl exec ... printenv HOSTNAME`
  returned `product-service-756c8f88dd-lgctc`, matching the pod's real
  name exactly) - not assumed.

- **Deployment:** reused the exact process already verified for the
  bcrypt fix rather than improvising a new one - manual build/tag/push,
  bypassing the push-triggered GitHub Actions pipeline
  (`.github/workflows/deploy.yml`, which would otherwise rebuild and
  redeploy all 5 services on any push to `enhanced-microservices`).
  Built `services/product-service` locally, tagged with the commit SHA
  (`c1d69811e79fb1ccb966a7fc4c5834637c297b0c`), pushed to ECR, `kubectl
  set image deployment/product-service`, confirmed via `kubectl rollout
  status` ("successfully rolled out"). Verified the header actually
  reaches the client through the full path (API Gateway -> VPC Link ->
  pod) with two real curl requests before running the experiment,
  confirming two distinct pod names on repeated calls.

- **Method:** both conditions run via the public API Gateway path (the
  real client-facing route), from `buildmart-k6-runner`, N=250 each
  (above the plan's 200 minimum):
  - **Idle:** k6 `shared-iterations`, 1 VU, sequential.
  - **Load:** k6 `shared-iterations`, 20 VUs, concurrent burst.
  2 product-service pod replicas were running throughout
  (`product-service-5b86c85dd9-fp87z`, `product-service-5b86c85dd9-p59mf`).

- **Results:**

  | Condition | Pod | Count | % |
  |---|---|---|---|
  | Idle (N=250) | fp87z | 115 | 46.0% |
  | Idle (N=250) | p59mf | 135 | 54.0% |
  | Load (N=250) | fp87z | 124 | 49.6% |
  | Load (N=250) | p59mf | 126 | 50.4% |

- **Finding, checked rather than eyeballed:** both conditions show a
  working, roughly even round-robin split across both replicas - no
  pod was starved or dominant in either condition. Idle's 54/46 split
  looks like a possible "connection reuse concentrates traffic"
  pattern at first glance, but checked against the binomial standard
  error for N=250 at true p=0.5 (~3.16 percentage points), it's only
  ~1.3 standard errors from even - within ordinary sampling noise, not
  a compelling signal of a real idle-vs-load difference. Reported as:
  **no meaningful distribution difference found between idle and load
  conditions** in this deployment - a valid, honest experimental
  outcome, not forced into the more dramatic story the plan's own
  framing anticipated as possible.

- **Cleanup:** reverted the temporary header
  (`git revert c1d6981`, commit `528b759`), rebuilt, pushed a new
  ECR-tagged image, redeployed via the same manual process, and
  confirmed via a real curl request that the header no longer appears
  in production responses - not left in the codebase or the running
  deployment.

- **Status:** COMPLETE.
- **Stage:** Enhanced Microservices.