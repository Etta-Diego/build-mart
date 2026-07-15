markdown# build-mart

E-commerce application built as three architectural stages for an MSc 
dissertation studying application-loading efficiency in cloud-deployed 
microservices.

## Stages
- `backend/` — Stage 1: Monolith (tag: v1.0-monolith-baseline)
- `services/` — Stage 2/3: Microservices decomposition (branches: 
  baseline-microservices, enhanced-microservices)

## Setup
See docs/DECISION_LOG.md for architectural rationale.

## Getting Started — Running Stage 1 (the Monolith) Locally

### 1. Prerequisites
- **Node.js 18+** (no `engines` field is pinned in either `package.json`; this was verified against Node v20.20.2)
- **Docker** — for local MongoDB and Redis *infrastructure only*. The backend application itself is intentionally **not** containerized in Stage 1 (see `CLAUDE.md` / `docs/DECISION_LOG.md`)
- **A Stripe account in test mode** — you'll need a secret key and a matching publishable key from the *same* account

### 2. Setup
Clone the repo, then from its root:

**Backend env vars** — copy `.env.example` to `.env` and fill in real values:

| Variable | Purpose |
|---|---|
| `PORT` | Port the backend listens on (default `5000`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Legacy JWT signing secret |
| `ACCESS_TOKEN_SECRET` | Signs short-lived access tokens |
| `REFRESH_TOKEN_SECRET` | Signs refresh tokens |
| `STRIPE_SECRET_KEY` | Stripe secret key, **must start with `sk_test_`** |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary image uploads |
| `CLIENT_URL` | Frontend origin, used for Stripe's checkout redirect URLs |
| `REDIS_URL` | ioredis connection string (defaults match `docker-compose up -d` below) |

**Frontend env vars** — copy `frontend/.env.example` to `frontend/.env`:

| Variable | Purpose |
|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key, **must start with `pk_test_`** |

> ⚠️ **`STRIPE_SECRET_KEY` and `VITE_STRIPE_PUBLISHABLE_KEY` must come from the *same* Stripe account.** A mismatched pair was a real bug found during Phase 1 verification — checkout silently fails at the redirect step if they don't match (see `docs/DECISION_LOG.md`).

Install dependencies:
```bash
npm install
npm install --prefix frontend
```

### 3. Start infrastructure
```bash
docker-compose up -d
```
Starts `mongo` (MongoDB 7, `localhost:27017`) and `redis` (Redis 7, `localhost:6379`) — matching the defaults in `.env.example`. No `backend` service is defined here; that's expected.

> **No Docker available?** Phase 1 verification itself was done without Docker (not available in that environment) by running MongoDB and Redis natively inside WSL instead, with the backend on the Windows host connecting to them via the WSL instance's IP. Any reachable MongoDB/Redis works — point `MONGO_URI`/`REDIS_URL` in `.env` at wherever they're actually running. See `docs/DECISION_LOG.md` ("Phase 1 verification: method and one known gap") for exactly how that was set up.

### 4. Start the application
```bash
npm run dev
```
(`npm start` also works, without auto-reload.) A successful boot logs, in this order:
```
MongoDB connected: <host>
Server is running on http://localhost:5000
```
That ordering is deliberate — the server only starts listening after MongoDB has connected (see `docs/DECISION_LOG.md`).

To run the frontend:
```bash
npm run dev --prefix frontend
```
Available at `http://localhost:5173`.

### 5. Verify it's running
```bash
curl http://localhost:5000/metrics
```
Should return Prometheus-format text (`app_ready_timestamp_seconds`, `http_requests_total`, etc.) — the quickest smoke test that the app booted correctly. Then open `http://localhost:5173` for the storefront.

**API endpoints of note:**
- `GET /metrics` — Prometheus-format metrics: startup/readiness timing, HTTP request duration/count by route+method+status, process CPU and memory usage.
- `GET /api/orders` — order history for the logged-in user.
- `GET /api/orders/:id` — a single order (owner or admin only).

### 6. Running tests / manual verification
There's no automated test suite yet — see `docs/DECISION_LOG.md` for the full Phase 1 manual verification record (Order module, instrumentation, Redis activation, startup ordering, Stripe key pairing). To manually verify a full checkout, use a real Stripe test-mode card (`4242 4242 4242 4242`, any future expiry, any CVC) — Stripe Checkout Sessions can only be completed through the hosted page, not via API.

(Stage 2/3 setup instructions to be added as each stage stabilises.)