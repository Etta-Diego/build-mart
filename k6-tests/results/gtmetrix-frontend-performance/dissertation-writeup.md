# 4.7.3.10 Frontend Page Load Performance (Cross-Architecture Comparison)

## Scope Note — Distinct From the CDN Cache-Hit/Cache-Miss Evaluation

This is a separate experiment from Section 4.7.3.9 (CDN Performance
Evaluation). Section 4.7.3.9 isolates the contribution of CloudFront's
edge caching in isolation (cache HIT vs. cache MISS on the same
distribution). This section instead compares full, real-browser page
load performance **across all three architectures** using GTmetrix -
a different research question (how does each deployed system load for a
real visitor) using a different tool and methodology. Neither dataset
supersedes or should be conflated with the other.

**This dataset uses only AWS/GTmetrix-verified measurements.** The
discarded, local-network-contaminated CDN cache-hit measurements from
earlier in this project (superseded by the AWS-runner rerun documented
in the corresponding decision log entry) are unrelated to this dataset
and are not referenced here.

## Methodology

- **Tool:** GTmetrix (Lighthouse 12.6.1)
- **Test server location:** London, UK
- **Browser:** Chrome 142.0.0.0
- **Test type:** Full frontend page load (not an isolated API or CDN
  cache-state test)
- Same React/Vite application UI and assets used across all three
  architectures
- Measurements repeated multiple times per architecture to account for
  variation; observed values recorded without manipulation

**Data-validity note (resolved before this dataset was accepted):** the
Baseline Microservices frontend had a same-day regression - a stale
build calling `localhost` API URLs instead of the real deployed
endpoints (see the corresponding decision log entry, "Baseline frontend
regression - localhost API URLs..."). The Baseline GTmetrix runs used
in this dataset were explicitly confirmed to have been captured
**after** that fix was deployed and verified; an earlier six-run
Baseline dataset from before this confirmation was discarded and is not
used here, precisely because its timing relative to the fix could not be
confirmed.

## Raw Results

**Monolith** (`http://13.38.201.124:5000/`)

| Run | Perf. Grade | FCP | LCP | Speed Index | TTI | TTFB | Fully Loaded |
|---|---|---|---|---|---|---|---|
| 1 | 97% | 983 ms | 983 ms | 1.1 s | 989 ms | 30 ms | 6.8 s |
| 2 | 100% | 651 ms | 650 ms | 724 ms | 650 ms | 22 ms | 6.5 s |
| 3 | 99% | 778 ms | 778 ms | 890 ms | 892 ms | 26 ms | 6.7 s |

**Baseline Microservices** (`http://15.237.90.142/`, post-localhost-fix)

| Run | Perf. Grade | FCP | LCP | Speed Index | TTI | TBT | Fully Loaded | TTFB |
|---|---|---|---|---|---|---|---|---|
| 1 | 62% | 3.6 s | 3.6 s | 3.6 s | 3.7 s | 31 ms | 9.3 s | 3.0 s |
| 2 | 59% | 4.3 s | 4.3 s | 4.3 s | 4.3 s | 0 ms | 11.2 s | 3.0 s |
| 3 | 63% | 3.4 s | 3.4 s | 3.4 s | 3.5 s | 65 ms | 10.7 s | 3.0 s |

**Enhanced Microservices** (`https://d1iyf15c0shdw7.cloudfront.net/`)

| Run | Perf. Grade | FCP | LCP | Speed Index | TTI | TTFB | Fully Loaded |
|---|---|---|---|---|---|---|---|
| 1 | 100% | 662 ms | 662 ms | 706 ms | 662 ms | 32 ms | 6.2 s |
| 2 | 100% | 526 ms | 525 ms | 538 ms | 525 ms | 33 ms | 6.2 s |
| 3 | 100% | 664 ms | 663 ms | 713 ms | 663 ms | 36 ms | 7.6 s |

All averages below were independently recomputed from these raw runs,
not merely copied from the supplied summaries, to confirm accuracy
before being recorded as the validated dataset.

## Table 4.X: Frontend Page Load Performance (GTmetrix, averaged)

| Architecture | URL | Avg FCP | Avg LCP | Avg Speed Index | Avg TTI | Avg TTFB | Avg Fully Loaded Time |
|---|---|---|---|---|---|---|---|
| Monolith | `http://13.38.201.124:5000/` | 804 ms | 804 ms | 905 ms | 844 ms | 26 ms | 6.67 s |
| Baseline Microservices | `http://15.237.90.142/` | 3.77 s | 3.77 s | 3.77 s | 3.83 s | 3.00 s | 10.40 s |
| Enhanced Microservices | `https://d1iyf15c0shdw7.cloudfront.net/` | 617 ms | 617 ms | 652 ms | 617 ms | 34 ms | 6.67 s |

## Interpretation

The results do not show a simple "fewer services is always faster" or
"microservices are always faster" pattern - they show two architectures
(Monolith and Enhanced) performing closely to each other and
substantially ahead of the third (Baseline), for different, named
reasons in each case.

**Monolith** benefits from a single backend endpoint and simpler request
routing: the browser talks to one origin for both the page and its API
calls, with no cross-service network hops before content can render -
consistent with its low TTFB (26 ms) and fast FCP/LCP (804 ms).

**Baseline Microservices** introduces additional network routing and
multiple independent service dependencies (separate EC2 instances for
auth, products, cart, coupons, and orders, each reached over a direct,
uncached network hop with no CDN or reverse proxy in front of them).
This is directly visible in its TTFB (3.00 s, roughly 100x Monolith's
and Enhanced's) and its FCP/LCP (3.77 s) - consistent with the frontend
needing to establish and wait on multiple uncached, cross-instance
network round trips before initial content can paint.

**Enhanced Microservices** benefits from CloudFront CDN delivery, HTTPS
edge caching, and an optimised cloud delivery path for its static
frontend assets, reducing initial frontend delivery latency (TTFB 34 ms,
FCP/LCP 617 ms) despite Enhanced having the same number of
decomposed backend services as Baseline. The distinguishing factor
between Baseline and Enhanced here is not "more microservices vs.
fewer" - both have five - it is the presence of CDN-based static asset
delivery in front of Enhanced's frontend, which Baseline's frontend
lacks entirely (served directly from a single EC2 instance via nginx,
no CDN).

The overall pattern is best read as: frontend loading performance is
driven by *how* a deployment routes and delivers its initial
request-response path (single origin, CDN-fronted, or multiple
uncached cross-instance hops), not by architectural style in the
abstract. Baseline is not slow because it is "microservices" - it is
slow because, unlike Enhanced, it decomposed its backend without also
adding any caching or edge-delivery layer in front of its frontend.

## Limitations and Threats to Validity

- Small run counts (3 per architecture) — sufficient to establish a
  clear, large-magnitude pattern (Baseline's gap from the other two is
  several multiples, not a marginal difference), but not intended to
  support fine-grained statistical claims between Monolith and Enhanced,
  whose results overlap closely.
- Single test-server location (London, UK) — results reflect that
  specific network path to each architecture's `eu-west-3` deployment,
  not a global average.
- Baseline's validity was specifically confirmed post-fix, per the
  data-validity note above; the discarded pre-confirmation dataset is
  not included or referenced further.
