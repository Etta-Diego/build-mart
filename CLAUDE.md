# Project Context for Claude Code

## What this project is
MSc dissertation implementation: "Development and Deployment of a 
Microservice-Based Architecture System for Efficient Application Loading 
in Cloud Environment." An e-commerce application (build-mart) built as 
three sequential architectural stages, compared empirically.

## Research design (do not deviate without asking)
- Stage 1: Monolith (backend/) — tagged v1.0-monolith-baseline once complete
- Stage 2: Baseline Microservices (services/) — decomposed from Stage 1, 
  no orchestration/gateway/CI-CD yet
- Stage 3: Enhanced Microservices — Stage 2 + Kubernetes + API Gateway + 
  Redis caching + CI/CD + cloud deployment

Two comparisons: Monolith vs Baseline (deployment efficiency, accessibility, 
loading performance); Baseline vs Enhanced (scalability, resilience, 
resource utilisation under load).

## Fixed technical decisions (do not suggest changing these)
- Database: MongoDB (Mongoose) throughout ALL three stages — this is 
  intentional for methodological consistency, not an oversight
- Cart: Redis-backed (not MongoDB), extracted from User in Stage 2 onward
- Instrumentation: prom-client, /metrics endpoint, same metric names 
  across all three stages for direct comparability
- Domain services (Stage 2/3): user, product, cart, order, coupon. 
  Analytics is NOT a service — it's a composition/aggregation layer, 
  admin-role-gated
- Deployment: Stage 1 (monolith) runs as a plain Node.js process, NOT 
  containerized — this is an intentional scope decision. Containerisation 
  begins at Stage 2 (Baseline Microservices).
- Auth (Stage 2/3): stateless JWT verification ("Option A") — each 
  service verifies the access token's signature locally against a shared 
  ACCESS_TOKEN_SECRET and trusts the decoded { userId, role } claims 
  directly. No per-request database lookup, no cross-service call, not 
  even from User/Auth Service's own routes. Tradeoff: role changes 
  propagate on next login/token refresh, not instantly. Centralized, 
  always-current authorization is deferred to the API Gateway in Stage 3.
- auth.middleware.js is duplicated (not imported/shared) into every 
  service that needs it — deliberate service independence, not a 
  code-sharing oversight.

## Current stack
Node.js, Express, MongoDB/Mongoose, Redis (ioredis), Stripe, Cloudinary, 
JWT auth (bcryptjs + jsonwebtoken), React/Vite frontend

## Workflow expectations
- Always update docs/DECISION_LOG.md when making an architectural or 
  design decision, with a brief rationale — this feeds directly into 
  the dissertation's methodology chapter
- Always update README.md when project structure or setup steps change
- Before touching payment/checkout logic, confirm the change with me — 
  this is the highest-risk code path in the project
- Prefer showing a plan before multi-file changes

## Current phase
Stage 1 (Monolith) and Stage 2 (Baseline Microservices) are both
complete and verified. Stage 1 is tagged through v1.4-monolith-baseline
(instrumented baseline, admin Order Overview, product search, the
AbortController race-condition fix, and all four performance
optimizations below). Stage 2 — built on the `baseline-microservices`
branch — has all five domain services extracted (user, product, cart,
coupon, order), Order Overview and Search mirrored in, and the same
four performance optimizations (indexes, pagination, compression,
Promise.all) mirrored in and verified with matching rigor, including a
direct monolith-vs-Baseline timing comparison for the Promise.all
`deleteProduct` change. See docs/DECISION_LOG.md for the full decision
history and every verification method used.

Stage 3 (Enhanced Microservices) is now beginning on the new
`enhanced-microservices` branch, created from `baseline-microservices`'
current tip (commit 6b804ad). No Kubernetes/API Gateway/Redis
caching/CI-CD work has started yet.