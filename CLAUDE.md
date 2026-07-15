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
Phase 1 implementation is complete and verified: Order module extracted
(order.controller.js/order.route.js), prom-client instrumentation
(lib/metrics.js, /metrics endpoint), startup-race and checkout-hang bugs
fixed, Redis activated. See docs/DECISION_LOG.md for the full list of
decisions and the one known verification gap (live Stripe checkout
round-trip untested — placeholder key in .env). Awaiting explicit
go-ahead to commit and tag v1.0-monolith-baseline.