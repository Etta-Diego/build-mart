# 4.7.3.9 CDN Performance Evaluation

## Rerun Notice

This rerun **replaces** the previous CDN Performance Evaluation in its
entirety. The prior measurements were discarded because they were
contaminated by client-side conditions unrelated to CloudFront's actual
behaviour — a local residential network connection with intermittent
timeouts, and a loss of SSH access to the project's AWS test
infrastructure partway through. Every measurement in this section was
captured from an AWS EC2 instance within `eu-west-3` (the same region as
the CloudFront distribution's origin), eliminating the residential-network
confound entirely. No numbers from the previous run are reused here.

## Objective

Isolate the performance contribution of CloudFront's edge caching within
the Enhanced deployment, independent of backend architecture. The
independent variable is cache state (HIT vs. MISS) on a single CloudFront
distribution; no other variable was permitted to change. Consistent with
the approved methodology, this experiment does not compare CloudFront
against direct S3 access (the origin is correctly locked down via Origin
Access Control and was not exposed for this test) and does not compare
different hosting infrastructures (e.g. Monolith vs. Enhanced).

## Pre-Run Validation

| Check | Result |
|---|---|
| SSH connectivity to AWS runner (`13.36.34.237`, eu-west-3) | Confirmed |
| AWS CLI functional | Confirmed (control-plane calls run locally; see Methodology) |
| CloudFront distribution health | `Status: Deployed`, `Enabled: true` |
| Test asset reachable | Confirmed, all four candidate assets return 200 |
| Cache can be warmed | Confirmed — all four assets verified `X-Cache: Hit from cloudfront` before Experiment 1 |

## Methodology

**Experiment 1 (cache HIT, steady state):** all four candidate static
assets (`/index.html`, the JS bundle, the CSS bundle, `/vite.svg`) warmed
and confirmed as `Hit from cloudfront`. A k6 script (`constant-vus`, 20
VUs, 3 minutes), rotating requests across the four assets, was copied to
and executed **on** the AWS runner via SSH — the measured HTTP requests
themselves originate from AWS, not from a local machine.

**Experiment 2 (cache MISS, controlled cycles):** a sustained miss
condition cannot exist for identical requests, since the first miss
immediately repopulates the edge cache. 25 independent cycles were run
against the CSS bundle (the representative asset, chosen to keep total
invalidation-propagation time practical): `aws cloudfront
create-invalidation` → `aws cloudfront wait invalidation-completed` →
one timed request issued **on the AWS runner via SSH** → confirmed
`X-Cache: Miss from cloudfront` → latency recorded. The AWS
control-plane calls (invalidation creation and wait) ran from the local
orchestrating machine, since their own timing is not part of the
reported metric and this avoided placing AWS credentials on the shared
test runner; the actual measured HTTP request — the only thing reported
as a result — always executed on the AWS-hosted runner.

**A methodological correction made during execution, disclosed per the
"stop and explain" instruction:** the first attempt to run Experiment 2
produced a contaminated single test reading, because Experiment 1's
sustained load test (which also hits the CSS bundle) was still running
concurrently and re-warmed the cache within the same second the
invalidation completed. Experiment 2 was only started after confirming
Experiment 1 had fully finished, avoiding any cross-experiment
interference.

## Results

**Experiment 1 — Cache HIT (20 VU, 3 min, AWS-runner-executed):**

| Metric | Value |
|---|---|
| Sample size | 495,921 requests |
| Success rate | 100.00% |
| Confirmed-hit rate | 99.99% |
| Mean | 7.02 ms |
| Median | 6.10 ms |
| Min | 1.37 ms |
| Max | 323.53 ms |
| p90 | 11.76 ms |
| p95 | 13.78 ms |
| p99 | 18.22 ms |
| Standard deviation | Not computed — not practical to derive an exact figure from ~496k samples without a full raw per-request export; the tight percentile spread (p50 6.1ms to p99 18.2ms) is reported instead. |

**Experiment 2 — Cache MISS (25 controlled cycles, AWS-runner-executed):**

| Metric | Value |
|---|---|
| Sample size | 25 (25 valid, 0 excluded) |
| Mean | 94.84 ms |
| Median | 92 ms |
| Min | 79 ms |
| Max | 136 ms |
| p90 | 114 ms |
| p95 | 126 ms |
| Standard deviation | 13.92 ms |
| Invalidation propagation time | 23-24s per cycle (consistent) |

## Table 4.X: Frontend Delivery Performance (Rerun — AWS-Verified)

| Deployment | Delivery Method | Request Type | Sample Size | Mean (ms) | Median (ms) | p95 (ms) |
|---|---|---|---|---|---|---|
| Enhanced Deployment | CloudFront CDN — HIT | Static Frontend Assets | 495,921 | 7.02 | 6.10 | 13.78 |
| Enhanced Deployment | CloudFront CDN — MISS | Static Frontend Assets | 25 | 94.84 | 92 | 126 |

## Interpretation

Median cache-hit latency (6.1ms) is approximately **15x lower** than
median cache-miss latency (92ms), measured from the identical AWS-hosted
vantage point against the identical CloudFront distribution and
representative asset, with cache state as the only varied condition.
Both distributions are notably tight (hit: p50-p99 spans 6.1-18.2ms;
miss: min-max spans 79-136ms, sd 13.92ms) — a marked contrast to the
previous, discarded run, where local-network noise produced multi-second
outliers and a p99 nearly 1,000x the median. This tightness is itself
evidence that the confound has been removed: genuine CloudFront edge and
origin-fetch behaviour, measured from a controlled AWS environment, is
consistent and well-behaved.

This improvement represents the contribution of CDN-based content
delivery within the enhanced deployment environment and should not be
interpreted as an isolated effect of microservice decomposition. The
hit condition reflects CloudFront serving content directly from its edge
cache; the miss condition reflects the added cost of the edge-to-origin
round trip to the S3 bucket in `eu-west-3` before CloudFront can
respond. Neither measurement touches, or is influenced by, the backend
microservice architecture evaluated elsewhere in this dissertation.

## Limitations and Threats to Validity

- **Single geographic vantage point**: all requests originated from one
  AWS EC2 instance in `eu-west-3`. This experiment measures CloudFront's
  caching contribution from that specific location, not global edge
  performance across CloudFront's ~400+ points of presence — a broader,
  separately-logged, not-yet-executed multi-region experiment
  (`docs/decision_log.md`, "PLANNED: WebPageTest...") would be needed for
  that claim.
- **The cache-miss condition used one representative asset (the CSS
  bundle), not all four**, to keep the total real-world invalidation
  propagation time (23-24s per cycle x 25 cycles) practical. Disclosed as
  a deliberate scope decision, not a hidden limitation.
- **n=25 for the miss condition**: sufficient for mean/median/min/max/p90
  and a meaningful standard deviation, but p95 and above should be read
  as indicative rather than statistically robust at this sample size.
- **AWS CLI control-plane calls (invalidation create/wait) ran from the
  local machine, not the AWS runner** — this is not a validity concern
  for the reported metrics, since only the actual timed HTTP
  request (executed on the AWS runner) was measured or reported; the
  control-plane call timing was orchestration overhead, never part of
  the results.
- **A temporary security-group change was required** to restore SSH
  access to the AWS runner (the tester's ISP-assigned IP had changed
  since the runner was last configured) — an additive rule permitting
  the current IP on port 22, made with explicit confirmation before
  proceeding, documented in the corresponding decision log entry.
