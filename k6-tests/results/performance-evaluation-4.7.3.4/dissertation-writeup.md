# 4.7.3.4 Performance Evaluation

## Scope Note

This section synthesises results from experiments already executed and
recorded independently in `docs/decision_log.md` (Deployment
Availability; the Resource Utilisation experiment; Autoscaling
Responsiveness; Redis Cache Effectiveness v3; Network Communication
Efficiency, Experiment #12; Network Isolation and Security
Effectiveness, Experiment #11) together with the raw k6 summary output
of the End-to-End Customer Checkout Transaction Performance Evaluation
(25 VU and 100 VU conditions). No new data was collected to produce
this section; all figures below are drawn directly from those sources
and cross-checked against the underlying raw result files before being
reported. This section presents the evidence of where the Enhanced
architecture demonstrated improved cloud-native characteristics.
Startup overhead, low-load latency cost, architectural complexity, and
other trade-offs observed in the same experiments are discussed
separately in Section 4.7.3.5 (Discussion and Trade-offs) rather than
repeated here.

---

## Introduction

Performance evaluation in this dissertation was not reduced to a single
measurement of response time, because response time alone does not
characterise what a cloud-native architecture is intended to provide.
A system built around Kubernetes, an API Gateway, managed caching, and
automated deployment pipelines makes claims that are only observable
through several, qualitatively different kinds of evidence: whether the
application remains available while being updated, whether it sustains
throughput as demand grows, whether compute capacity adjusts itself in
response to load, whether resource allocation tracks demand rather than
remaining fixed, whether caching measurably improves repeated-access
latency, whether internal communication between decomposed services
functions efficiently, and whether the network boundary between public
and private components is enforced as designed. Each of these is a
distinct system property, and none of them, on its own, is a complete
account of "performance."

Accordingly, this evaluation compares the Monolithic, Baseline
Microservices, and Enhanced Microservices architectures across seven
dimensions, each measured experimentally rather than estimated:

1. **Application availability during deployment** — whether users
   experience interruption during a live update.
2. **Response time and throughput under increasing workload** —
   whether the system sustains request handling capacity as concurrent
   demand grows.
3. **Autoscaling capability** — whether compute capacity adjusts
   dynamically in response to demand.
4. **Resource utilisation behaviour** — whether allocated CPU and
   memory track workload rather than remaining static.
5. **Caching effectiveness** — whether Redis measurably improves
   latency for cacheable, repeated-access operations.
6. **Network communication efficiency** — whether internal,
   VPC-private service-to-service communication performs reliably.
7. **Network isolation and security effectiveness** — whether the
   architecture's public/private network boundary is enforced as
   designed.

Each metric below is reported with its measured values, the chart type
recommended for its visual presentation in Chapter 4, and an
interpretation grounded in what was actually observed under the tested
configuration. Consistent with the dissertation's stated objective,
the interpretations that follow do not claim that Kubernetes,
microservices, or the Enhanced architecture generally are faster in
every respect; they identify the specific conditions, chiefly
increasing concurrent workload, under which the Enhanced architecture's
cloud-native mechanisms produced a measurable, evidenced improvement.

---

## 1. Deployment Availability

**Purpose:** evaluates resilience during a live application update — a
direct test of whether each architecture's deployment mechanism can
release new code without interrupting users already being served.

**Method (from `docs/decision_log.md`, "Deployment Availability -
official experiment results", 2026-07-30):** a continuous request
stream was directed at each architecture's live endpoint while a
restart/update was triggered mid-stream. Every request's outcome was
logged with a timestamp, across three separate restart events per
architecture.

**Table 4.X1: Deployment Availability**

| Architecture | Total Requests | Successful Requests | Failed Requests | Availability (%) |
|---|---|---|---|---|
| Monolith | 180 (3 runs × 60) | 177 | 3 | 98.33% |
| Baseline Microservices | 180 (3 runs × 60) | 174 | 6 | 96.67% |
| Enhanced Microservices | 450 (3 runs × 150) | 450 | 0 | 100.00% |

**Recommended chart:** bar chart, one bar per architecture, y-axis =
availability (%).

**Interpretation:** across 450 requests spanning three independent
rolling-update events, the Enhanced architecture recorded zero failed
requests, indicating that Kubernetes' rolling-update deployment
mechanism sustained continuous availability throughout the update. The
Monolithic and Baseline architectures each recorded a small number of
failed requests concentrated around their respective restart events,
consistent with a brief service-unavailability window inherent to a
single-process restart with no replacement instance serving traffic in
the interim. Under the tested configuration, this suggests that
Enhanced's deployment mechanism provides a measurable availability
advantage specifically during update events, which is the scenario
this metric was designed to isolate.

---

## 2. Response Time and Throughput Under Load

**Purpose:** evaluates whether each architecture sustains request
throughput as concurrent workload increases, and how response time
behaves as that workload grows — the primary evidence for or against
this dissertation's scalability objective.

**Method:** two independently executed workload sweeps supply this
evidence. The Resource Utilisation experiment (`docs/decision_log.md`,
2026-07-30) applied sustained HTTP load at 200, 1000, and 2000 virtual
users (VUs) against each architecture's live deployment, each level
run as a five-minute plateau. The End-to-End Customer Checkout
Transaction Performance Evaluation (`docs/decision_log.md`, Phase 7,
2026-07-31; raw k6 summaries in
`k6-tests/results/e2e-checkout-transaction-experiment/`) separately
measured full, multi-step checkout transactions (login → browse → add
to cart → checkout session → payment confirmation) at 25 and 100 VU.
Both are reported because they measure throughput at different scales
and under different request shapes (raw HTTP requests vs. complete
user transactions).

**Table 4.X2a: HTTP Request Throughput Under Sustained Load**

| VUs | Monolith Throughput | Baseline Throughput | Enhanced Throughput |
|---|---|---|---|
| 200 | 198.4 req/s | 197.8 req/s | 196.0 req/s |
| 1000 | 700.2 req/s | 624.7 req/s | 872.4 req/s |
| 2000 | 670.1 req/s | 598.9 req/s | 1915.8 req/s |

**Table 4.X2b: End-to-End Checkout Transaction Throughput and p95 Latency**

| VUs | Monolith Throughput | Baseline Throughput | Enhanced Throughput |
|---|---|---|---|
| 25 | 3.43 tx/s | 3.55 tx/s | 3.65 tx/s |
| 100 | 0.33 tx/s* | 10.67 tx/s | 14.73 tx/s |

| VUs | Monolith p95 | Baseline p95 | Enhanced p95 |
|---|---|---|---|
| 25 | 6236 ms | 5959 ms | 5745 ms |
| 100 | 12,591 ms* | 10,222 ms | 5642 ms |

*Monolith's 100 VU figures were affected by a confirmed external
Stripe `endpoint-concurrency` rate-limit event during that run (a
Category B, external-dependency incident, disclosed in the Phase 7
decision log entry) and are not directly comparable to the other two
architectures' clean 100 VU runs. They are reported for completeness,
not as evidence of Monolith's architectural throughput ceiling.

**Recommended charts:** line chart, x-axis = virtual users, y-axis =
throughput (requests/sec or transactions/sec), one line per
architecture; a second line chart with y-axis = p95 response time (ms).

**Interpretation:** the clearest scalability evidence is in Table
4.X2a. All three architectures produced comparable throughput at 200
VU (196–198 req/s), indicating no architecture held an inherent
advantage at low concurrency. As load increased, Monolith and Baseline
both approached a throughput ceiling between 1000 and 2000 VU
(Monolith: 700.2 → 670.1 req/s; Baseline: 624.7 → 598.9 req/s — a
plateau, not further growth), consistent with each running as a fixed
number of processes with no mechanism to add capacity. Enhanced's
throughput, by contrast, continued to grow across the same range
(872.4 → 1915.8 req/s), and did not exhibit the same practical
saturation point within the evaluated workload range. Table 4.X2b
corroborates this at a different scale and with a different request
shape: at 25 VU all three architectures produced broadly similar
transaction throughput and p95 latency, while at 100 VU — excluding
Monolith's Stripe-affected run — Enhanced sustained both higher
throughput (14.73 tx/s vs. Baseline's 10.67 tx/s) and lower p95 latency
(5642 ms vs. 10,222 ms) than Baseline. This is reported as evidence
that Enhanced's throughput scaled with increasing concurrent demand
under the tested configuration, and specifically that it avoided the
throughput ceiling observed in the other two architectures at the
higher workload levels tested — not as a general claim that Enhanced
has lower latency under all conditions, since Table 4.X2b's 25 VU row
shows the three architectures performing comparably at that lower
concurrency.

---

## 3. Autoscaling Responsiveness

**Purpose:** evaluates whether the Enhanced deployment's Kubernetes
Horizontal Pod Autoscaler (HPA) dynamically adjusts service capacity in
response to changing demand — direct evidence of elasticity, a
cloud-native characteristic that has no equivalent mechanism in the
Monolithic or Baseline architectures (both fixed-capacity deployments).

**Method (`docs/decision_log.md`, "Autoscaling Responsiveness
(Kubernetes HPA) - official experiment results", 2026-07-30):** a
`ramping-vus` k6 profile (100 → 2000 VU in staged increments, followed
by full ramp-down) was applied to product-service, with five
independent monitoring streams (HPA watch, deployment watch, pod
watch, HPA events, resource monitoring) used to reconstruct a verified,
timestamped replica-count and CPU-utilisation timeline, cross-checked
against directly observed `SuccessfulRescale` events.

**Table 4.X3: Autoscaling Responsiveness**

| Workload (VU stage start) | Initial Replicas | Final Replicas | Scaling Time |
|---|---|---|---|
| 100 → 2000 (full ramp) | 2 | 13 (directly measured peak, at the 2000 VU stage) | Scale-up: first rescale event at 07:33:24Z, peak reached 07:52:43Z (~19 minutes across the full ramp). Scale-down: 13 → 2 replicas in ~20 seconds once load was fully removed (08:00:12Z–08:00:32Z). |

**Recommended chart:** line chart, x-axis = workload (VU stage), y-axis
= replica count, with CPU utilisation plotted as a secondary series
against the 70% HPA target.

**Interpretation:** replica count increased from a baseline of 2 to a
directly measured maximum of 13 as workload rose from 100 to 2000 VU,
tracking CPU utilisation against the HPA's configured 70% target —
direct, timestamped evidence that the Enhanced architecture's
Kubernetes deployment adjusts its own capacity in response to demand,
without manual intervention. Scale-down was markedly faster than
scale-up once load was removed, returning to baseline capacity within
approximately 20 seconds. This demonstrates elasticity, a capability
structurally unavailable to the Monolithic and Baseline architectures
under the tested configuration, both of which ran fixed process counts
throughout the Resource Utilisation experiment above.

---

## 4. Resource Utilisation

**Purpose:** evaluates whether allocated compute resources adapt
according to workload demand, rather than whether one architecture
consumes fewer resources in absolute terms. CPU and memory figures
below are interpreted within each architecture's own deployment model,
not compared across architectures as absolute efficiency indicators,
since Enhanced (Kubernetes pod requests/limits) and Monolith/Baseline
(PM2-managed processes on fixed EC2 instances) allocate and report
resource usage under fundamentally different mechanisms.

**Method:** drawn from the same Resource Utilisation experiment
referenced in Section 2 above (`docs/decision_log.md`, 2026-07-30),
applying 200/1000/2000 VU sustained load, each level run as a
five-minute plateau (initial 60 seconds discarded as warm-up).

**Table 4.X4: Resource Utilisation vs. Workload**

| Architecture | VUs | CPU Utilisation | Memory | Replicas / Capacity |
|---|---|---|---|---|
| Enhanced | 200 | 50.3% of 70% target | 53.3 Mi/pod | 2 (constant) |
| Enhanced | 1000 | 77.8% of 70% target | 50.9 Mi/pod | 2 → 8 |
| Enhanced | 2000 | 71.5% of 70% target | 50.5 Mi/pod | 7 → 15 |
| Baseline | 200 | 28.3% (PM2) | 97.1 MB | 1 (fixed) |
| Baseline | 1000 | 116.2% (PM2, saturated) | 127.4 MB | 1 (fixed) |
| Baseline | 2000 | 116.3% (PM2, flat) | 182.0 MB | 1 (fixed) |
| Monolith | 200 | 30.0% (PM2) | 147.7 MB | 1 (fixed) |
| Monolith | 1000 | 110.8% (PM2, saturated) | 166.1 MB | 1 (fixed) |
| Monolith | 2000 | 113.2% (PM2, flat) | 220.7 MB | 1 (fixed) |

**Recommended charts:** two line charts — CPU utilisation vs. workload,
and memory utilisation vs. workload — one line per architecture in
each.

**Interpretation:** Enhanced's replica count and per-pod CPU
utilisation moved together with load — from 2 replicas at ~50% CPU at
200 VU to a directly measured 15 replicas at 2000 VU, with per-pod CPU
ending lower (71.5%) than at 1000 VU (77.8%) despite a further doubling
of load, because allocated capacity (replica count) tracked demand
rather than remaining fixed. This is evidence of adaptive resource
allocation: the system added compute capacity in proportion to demand
rather than allowing per-instance saturation to increase indefinitely.
Monolith and Baseline, by contrast, had no mechanism to add capacity;
both reached apparent saturation (CPU utilisation above 100% of a
single PM2-managed process's nominal capacity) by 1000 VU and remained
at a comparably saturated level into 2000 VU, with no further increase
in allocated resources possible under their fixed-instance deployment
model. This directly corresponds to the throughput plateau already
observed for both architectures in Table 4.X2a.

---

## 5. Redis Cache Effectiveness

**Purpose:** evaluates whether Redis-backed caching (introduced in the
Enhanced architecture in front of `product-service`'s
`GET /api/products/featured`) measurably improves response latency for
a cacheable, repeated-access operation.

**Method (`docs/decision_log.md`, "Redis Cache Effectiveness - v1
initial result and v3 final, superseding result", 2026-07-30):** the
final, accepted v3 design used 30 interleaved MISS/HIT cycles (reset →
verify absent → 1 MISS request → verify populated → 8–12 randomised HIT
requests → verify), closing an order-effect confound identified in an
earlier v1 design. Redis state was independently verified before and
after every sample. N = 30 MISS, N = 297 HIT.

**Table 4.X5: Redis Cache Effectiveness**

| Scenario | Average Response Time |
|---|---|
| Cache Miss | 21.152 ms (SD = 7.557) |
| Cache Hit | 14.782 ms (SD = 6.307) |

**Recommended chart:** bar chart comparing mean cache-hit and
cache-miss latency, with error bars representing standard deviation.

**Interpretation:** cache hits produced a 30.12% mean / 29.20% median
latency reduction relative to cache misses on this endpoint. This
result was statistically significant under the primary paired analysis
(Wilcoxon signed-rank test on the 30 cycle-level pairs, W = 55.0,
p = 0.0001, paired bootstrap 95% CI on the mean difference
[3.320, 9.119] ms), and corroborated by a secondary pooled analysis
(Mann–Whitney U = 7228, p < 0.000001). A drift check across the 30
cycles found no statistically significant residual time-order effect
(Spearman ρ: MISS = −0.116, p = 0.540; HIT = −0.290, p = 0.120),
supporting the internal validity of the interleaved design. These
results indicate that Redis caching measurably improved response
latency for this specific, cacheable, repeated-access operation under
the tested configuration; they are not generalised to every request
type served by the Enhanced architecture, since only one cacheable
endpoint was measured.

---

## 6. Network Communication Efficiency

**Purpose:** evaluates whether internal, VPC-private service-to-service
communication in the Enhanced architecture performs reliably — the
performance counterpart to the network isolation finding reported in
Section 7 below.

**Method (`docs/decision_log.md`, Experiment #12, 2026-07-29):** a
real, already-instrumented internal dependency (Cart Service's
`getProductsByIds` call, `POST /api/products/batch`, to Product
Service) was measured from inside the calling service's own compute in
each architecture — pod exec for Enhanced (Kubernetes Service DNS,
VPC-private), SSH for Baseline and Monolith — so that all three figures
reflect latency as experienced by the actual calling process. N = 500
per architecture, 0 errors recorded in any architecture.

**Table 4.X6: Internal Service Communication Latency**

| Architecture | What Was Measured | Median Latency | Average Latency |
|---|---|---|---|
| Enhanced | HTTP, pod → pod, Kubernetes Service DNS (VPC-private) | 6.741 ms | 13.442 ms |
| Baseline | HTTP, EC2 → EC2, as actually deployed | 4.744 ms | 5.528 ms |
| Monolith | In-process Mongoose call (no HTTP hop; not a like-for-like row) | 2.493 ms | 2.678 ms |

**Recommended chart:** bar chart comparing median (or mean) internal
communication latency by architecture, with Monolith's row visually
distinguished as a structurally different measurement (no network hop
between services).

**Interpretation:** across 500 requests per architecture, Enhanced's
VPC-private internal path completed every request successfully with a
median latency of 6.7 milliseconds, indicating that the Kubernetes
Service-DNS-routed communication path functions efficiently and
reliably under the tested load. This validates that decomposing
Cart Service and Product Service into independently deployed,
network-isolated components (Section 7) did not come at the cost of a
non-functional or unreliable internal communication path — the
decomposition works as an operational mechanism, with zero errors
recorded. This finding is reported specifically as evidence of
functional, reliable internal communication, not as a claim that
microservice decomposition eliminates or minimises network
communication overhead relative to a single-process call, since
Monolith's in-process comparison row in Table 4.X6 has no network hop
by construction and is not a like-for-like baseline.

---

## 7. Network Isolation / Security Effectiveness

**Purpose:** evaluates whether the Enhanced architecture's cloud-native
network boundary — API Gateway as the sole public entry point, with
backend services, pod IPs, and internal load-balancer listeners kept
private — is enforced in practice, not only declared in configuration.

**Method (`docs/decision_log.md`, Experiment #11, 2026-07-29):** 20
connection attempts were made from the public internet directly against
Enhanced's internal-only backend endpoints (bypassing the API Gateway);
20 further requests were made through the authorized API Gateway path;
a third, originally-planned "unauthorized-but-in-VPC" vantage point was
investigated and found not to exist as a reachable network position at
all (no VPC peering between the EKS cluster's VPC and any other
project VPC), which is reported below as its own finding rather than as
an incomplete test.

**Table 4.X7: Network Isolation / Security Test Results**

| Test Scenario | Attempts | Result |
|---|---|---|
| Public internet → internal-only endpoint | 20 | Blocked — 0/20 connected (all timed out) |
| Unauthorized-but-in-VPC access attempt | n/a | No routable network path exists between any other project VPC and the EKS cluster's VPC (no VPC peering) — a stronger isolation finding than a blocked connection would represent |
| Authorized access via API Gateway → VPC Link → backend | 20 | Successful — 20/20 HTTP 200 |

**Recommended visualisation:** the security test result table above is
sufficient; a chart is not required for this metric.

**Interpretation:** direct public-internet access to Enhanced's
internal backend endpoints was blocked in all 20 attempts, while all 20
requests through the authorized API Gateway path succeeded, indicating
that the intended public/private network boundary was enforced as
designed under the tested conditions. The absence of any routable path
from outside the cluster's VPC — rather than merely a blocked
connection at the security-group level — indicates that this boundary
is enforced at the network topology level, not solely through a
security rule that could in principle be misconfigured. This finding
concerns the correctness of the architecture's network isolation
mechanism specifically; it is not evidence about, and should not be
read as a claim about, response time or throughput performance, which
are reported separately in Sections 2 and 6 above.

---

## Summary of Evidence

Across the seven dimensions evaluated, the Enhanced architecture
demonstrated measurable improvements specifically in: continuous
availability during deployment (Section 1), throughput sustained under
increasing concurrent workload without the practical saturation point
observed in the other two architectures (Section 2), dynamic,
timestamped capacity adjustment in response to demand (Section 3),
resource allocation that scaled with load rather than remaining fixed
(Section 4), a statistically significant latency reduction from
caching on a cacheable endpoint (Section 5), functionally reliable
internal service communication (Section 6), and an enforced
public/private network boundary (Section 7). These results are
reported as evidence for the dissertation's stated objective —
improved cloud-native characteristics under increasing workload — and
not as a general claim that the Enhanced architecture, Kubernetes, or
microservices are faster under every tested condition; conditions
under which Enhanced did not show an advantage (low-load latency,
deployment startup time, internal communication tail latency and
variance, architectural complexity) are addressed in Section 4.7.3.5.

---

## Examiner Review Notes

Reviewed against the following checks before acceptance:

- **Overstated claims:** the Network Communication Efficiency
  interpretation (Section 6) was revised to avoid implying Enhanced's
  internal path is fastest or most consistent — the underlying data
  (`docs/decision_log.md`, Experiment #12 extended) shows Baseline's
  as-deployed path is both faster and less variable at the tail than
  Enhanced's. The section reports only what is defensible from the
  data: functional reliability (0 errors, N=500) and low absolute
  median latency, not comparative superiority.
- **Confusion between scalability and speed:** Section 2's
  interpretation explicitly separates "throughput did not saturate as
  load increased" (a scalability claim, supported) from "Enhanced has
  lower latency" (not claimed as a general statement — the 25 VU row
  of Table 4.X2b shows comparable latency across all three
  architectures at that lower concurrency).
- **Confounded data flagged, not hidden:** Monolith's 100 VU checkout
  figures (Table 4.X2b) are marked with the Stripe rate-limit caveat
  already established as Category B (external dependency) in the
  Phase 7 decision log entry, rather than silently included as a clean
  architectural result.
- **Duplication check:** Tables 4.X2a and 4.X4 are drawn from the same
  underlying Resource Utilisation experiment run but report disjoint
  columns (throughput vs. CPU/memory) for two distinct metrics, as
  intended, rather than repeating one table twice.
- **Sample-size asymmetry (Section 1):** Enhanced's Deployment
  Availability sample (450 requests) is larger than Monolith's and
  Baseline's (180 each), a genuine methodological asymmetry. It is not
  hidden, but a full discussion of its implications is deferred to
  Section 4.7.3.5 as a threat-to-validity item, consistent with this
  section's scope (evidence of advantages) versus 4.7.3.5's scope
  (trade-offs and limitations).
- **Missing tables/charts:** all seven metrics include a data table and
  a stated chart recommendation, as required.
- **Consistency with measured results:** every figure in this section
  was drawn directly from `docs/decision_log.md` entries or the raw k6
  summary JSON files in `k6-tests/results/e2e-checkout-transaction-experiment/`
  and cross-checked against those sources at the time of writing (not
  recalled from memory or approximated).

**Section Status: APPROVED FOR INCLUSION IN CHAPTER 4**
