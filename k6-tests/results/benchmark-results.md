# BuildMart Benchmark Results

## Methodology Notes
- Tests run from: [local machine (Onitsha, Nigeria) for initial 
  validation/cold-start tests; in-region EC2 instance planned for 
  full load tests, pending AWS vCPU quota approval]
- Each test repeated 2-3+ times; outliers flagged, not silently 
  discarded
- k6 version: 2.1.0

## 1. Cold-Start Time
Time from deployment restart trigger to first successful HTTP 200/401
response (401 counted as "service up" for auth-protected endpoints
with no token, per methodology established during Baseline testing).

### Monolith
Method: `pm2 restart` -> poll until first 200 on 
`/api/products/featured`

| Run | Time (ms) |
|-----|-----------|
| 1   | 1380      |
| 2   | 1294      |
| 3   | 1306      |

**Average: 1327ms**

_Earlier 5-run measurement (2026-07-xx, superseded by the above
3-run set): 1376, 1275, 1343, 1268, 1289 - Average: 1310ms | Min:
1268ms | Max: 1376ms._

### Baseline Microservices (all 5 services, combined)
Method: parallel `pm2 restart` on all 5 EC2 instances -> poll until 
all 5 respond correctly (200 for product-service, 401 for the other 
4 auth-gated services)

| Run | Time (ms) |
|-----|-----------|
| 1   | 5564      |
| 2   | 6275      |
| 3   | 5593      |

**Average: 5811ms**

### Enhanced Microservices (K8s rolling restart, all 5 Deployments)
Method: `kubectl rollout restart` on all 5 Deployments simultaneously 
-> `kubectl rollout status` timing until all 5 report successfully 
rolled out

| Run | Time (ms) |
|-----|-----------|
| 1   | 23759     |
| 2   | 22367     |
| 3   | 29951     |

**Average: 25359ms**

### Summary
Monolith is fastest to cold-start (~1.3s), Baseline next (~5.8s, 
reflecting the coordination cost of 5 independent process restarts), 
Enhanced slowest in raw wall-clock time (~25.4s) - but Enhanced's 
rollout uses Kubernetes' rolling update strategy, which is designed 
to maintain zero-downtime availability throughout the update (old 
pods only terminate after new pods pass health checks), unlike pm2
**[INCOMPLETE - sentence cut off in source input, needs the rest of
this contrast before this section is final]**.

## 2. Availability During Update
Methodology: continuous polling (10 req/sec) against each 
architecture's live endpoint, with a restart triggered mid-stream 
(at request 20), running until well past rollout completion.

### Monolith
3 runs x 60 requests = 180 total requests.

| Run | Requests | Failures | Failure timing |
|-----|----------|----------|-----------------|
| 1   | 60       | 1        | ~3.4-3.6s after restart trigger, immediately recovered on next request |
| 2   | 60       | 1        | ~3.4-3.6s after restart trigger, immediately recovered on next request |
| 3   | 60       | 1        | ~3.4-3.6s after restart trigger, immediately recovered on next request |

**Total: 3/180 failed.**

### Baseline Microservices (product-service)
3 runs x 60 requests = 180 total requests.

| Run | Requests | Failures | Failure timing |
|-----|----------|----------|-----------------|
| 1   | 60       | 1        | recovered within 1-2 requests |
| 2   | 60       | 3        | recovered within 1-2 requests |
| 3   | 60       | 2        | recovered within 1-2 requests |

**Total: 6/180 failed.**

### Enhanced Microservices (via API Gateway, product-service rolling restart)
3 runs x 150 requests = 450 total requests.

| Run | Requests | Failures |
|-----|----------|----------|
| 1   | 150      | 0        |
| 2   | 150      | 0        |
| 3   | 150      | 0        |

**Total: 0/450 failed - complete availability maintained throughout 
the entire rolling update.**

### Interpretation
This directly demonstrates the "increased downtime during updates" 
concern named in Chapter 1's Statement of the Problem. Enhanced's 
Kubernetes rolling-update strategy (new pod passes readiness checks 
before old pod terminates) achieves genuine zero-downtime deployment, 
at the cost of a longer total rollout time (~25s vs Monolith's 
~1.3s, Baseline's ~5.8s - see Section 1). This is the empirical basis 
for reframing "application loading efficiency" (Section 1.7) as a 
composite of both speed AND reliability, rather than raw restart 
speed alone.

## 3. Autoscaling Responsiveness (Enhanced only)

Methodology: k6 ramping load test (100 VUs, 5 minutes) against 
Enhanced's product-service endpoint, starting from a confirmed HPA 
baseline (2/2 replicas, <5% CPU), with kubectl get hpa --watch 
running in parallel to capture scaling events in real time.

Observed timeline:
| CPU% | Replicas | Event |
|------|----------|-------|
| 3% | 2 | Baseline (pre-load) |
| 64% | 2 | Load ramping up |
| 107-108% | 2 | Threshold breached (target: 70%) |
| 108% | 4 | First scale-up triggered |
| 56-80% | 4 | Sustained under new capacity |
| 77-80% | 5 | Second scale-up triggered |
| 58-68% | 5 | Settling under sustained load |

Result: HPA correctly detected the CPU threshold breach and scaled 
product-service from 2 to 5 replicas in response to sustained load, 
confirming genuine autoscaling behavior. Monolith and Baseline have 
no equivalent mechanism - their capacity is fixed regardless of load, 
which is itself a key architectural finding for the scalability 
comparison (Objective 3).

Note on request impact during scaling: this same test run showed a 
higher failure rate (0.43%, vs. 0.35% in an earlier, less-loaded run) 
and included a small number of explicit request timeouts, with one 
request taking as long as 2m23s. This reflects genuine, temporary 
degradation during the scale-up transition window itself (CPU at 
107-108%, briefly under-provisioned before the 3rd and 4th replicas 
came online) - a real, honest cost of the scaling process, not a 
system failure. Full new-replica capacity resolved the degradation 
within the same test run.

### Enhanced Scaling Test (500 VUs, post-infrastructure-expansion)

Prior to this test, two infrastructure changes were made to give 
Enhanced additional headroom:
1. HPA maxReplicas raised from 6 to 10 (product-service-hpa and 
   order-service-hpa)
2. EKS node group scaled from 2 to 3 t3.medium nodes

Result (in-region runner, post-M10 MongoDB upgrade):
- 500 VUs, 3 minutes, 65,772 requests
- 99.44% success rate (0.55% failure, 366 requests)
- p95 latency: 843.17ms
- Throughput: 358.77 req/s

This demonstrates Enhanced's capacity scales meaningfully with added 
infrastructure - handling 2.5x the concurrent load (200->500 VUs) 
with only a modest increase in failure rate (0.29%->0.55%) once given 
additional node capacity and a higher HPA ceiling. This is a direct, 
practical demonstration of horizontal scalability: capacity grows 
when resources are added, in contrast to Monolith and Baseline, 
which have no equivalent mechanism and would require manual instance 
resizing (with associated downtime) to achieve the same effect.

### Enhanced Full-Scale Test (100-2000 VUs, Post-Infrastructure-Correction)

Infrastructure state for this test series: pods resized (500m/1000m 
CPU for product-service and order-service), HPA maxReplicas raised 
to 20, EKS node group scaled to 11 t3.medium nodes (target was 12, 
blocked by EC2 vCPU account quota - see decision_log.md), MongoDB 
Atlas on M10 tier.

| VUs | Failure rate | p95 latency | Throughput |
|-----|--------------|-------------|------------|
| 100 | 0.18% | 21.67ms | 98.6 req/s |
| 200 | 0.10% | 25.06ms | 196.2 req/s |
| 400 | 0.12% | 108.39ms | 386.4 req/s |
| 600 | 0.16% | 165.31ms | 571.4 req/s |
| 800 | 0.18% | 35.86ms | 774.8 req/s |
| 1000 | 0.08% | 80.33ms | 966.9 req/s |
| 1200 | 0.06% | 52.07ms | 1160.3 req/s |
| 1400 | 0.30% | 1.31s | 797.0 req/s |
| 1600 | 0.06% | 193.36ms | 1499.9 req/s |
| 1800 | 0.72% | 912.44ms | 1305.5 req/s |
| 2000 | 0.53% | 715.24ms | 1412.6 req/s |

Key finding: performance remained excellent and stable up to 1200 
VUs (2 replicas sufficient, no scaling needed). From 1400-2000 VUs, 
the system entered an active scaling transition zone (confirmed via 
live HPA monitoring - product-service scaled from 2 to 15 replicas 
during this range), characterized by variable but bounded strain: 
brief spikes in latency/failure rate (1400 VUs: p95 1.31s, 0.30% 
failure; 1800 VUs: p95 912ms, 0.72% failure) followed by recovery 
once new capacity stabilized (1600 VUs: p95 193ms, 0.06% failure). 
Failure rate never exceeded 0.72% and remained well within the 5% 
threshold throughout the entire 100-2000 VU range (a 20x increase in 
load), demonstrating that Enhanced's architecture can absorb 
substantial, sustained demand growth through horizontal autoscaling, 
with temporary but bounded performance variability during active 
scaling events - a realistic and honest characterization of 
autoscaling behavior under genuine load growth.

## 4. Resource Utilization Under Load (Enhanced)

Methodology: kubectl top pods polled every 5 seconds throughout the 
same 5-minute load test described in Section 3, logged to 
k6-tests/results/enhanced-resource-usage-run2.csv (397 data points 
across all pods over the test duration).

[Note: raw CSV data available for chart generation - timestamp, pod 
name, CPU (millicores), memory (Mi) per row. Resource usage naturally 
correlates with the autoscaling timeline in Section 3, showing 
per-pod CPU/memory consumption before, during, and after the scaling 
events.]

Action item: Monolith and Baseline resource utilization (via SSH-based 
top/free polling or CloudWatch) still needs to be captured for a full 
three-architecture comparison on this metric.

## 5. Read-Heavy Load Test (k6)
(pending - local validation runs noted separately from official 
in-region runs)

### Local validation runs (NOT for dissertation use - network confound, see Methodology Notes)

(small-scale 15s validation results can go here, clearly marked as 
preliminary/invalid for final reporting)

### Monolith Load Ceiling

| VUs | p95 latency | Avg latency | Max latency | HTTP failures | Notes |
|-----|-------------|--------------|--------------|----------------|-------|
| 100 | 589.74ms | 253.6ms | 6.4s | 0% | Clean |
| 200 | 1.84s | 843.62ms | 4.96s | 0% | Noticeable strain |
| 300 | 3.00s (threshold breached) | 1.68s | 36.33s | 0% (but 292/6849 iterations interrupted/timed out) | Severe degradation |
| 400 | 33.44s | 6.87s | 60s (timeout) | 2.33% (223/9567 requests) | Genuine breaking point - connection failures and widespread timeouts |

Key finding: Monolith on a t3.small instance shows a clear 
degradation curve: negligible impact up to 100 VUs, increasing 
latency strain through 200-300 VUs while still technically succeeding 
on every request, and a genuine capacity ceiling at 400 VUs where 
real connection failures and request timeouts begin (2.33% failure 
rate, p95 latency of 33.44 seconds). This provides a complete, 
empirically-measured capacity profile for a fixed-resource 
architecture, directly supporting Objective 3's evaluation of 
scalability and resource utilization limits.

### Monolith Full-Scale Test (100-2000 VUs, in-region runner, post-MongoDB M10 upgrade)

Matching the same VU levels as the Enhanced Full-Scale Test above, 
for direct comparison.

| VUs | Failure rate | p95 latency | Throughput |
|-----|--------------|-------------|------------|
| 100 | 0.00% | 8.99ms | 99.3 req/s |
| 200 | 0.00% | 8.9ms | 198.1 req/s |
| 400 | 0.00% | 23.37ms | 394.5 req/s |
| 500 | 0.00% | 50.25ms | 487.8 req/s |
| 600 | 0.00% | 100.62ms | 580.0 req/s |
| 800 | 0.00% | 312.41ms | 704.4 req/s |
| 1000 | 0.00% | 567.64ms | 725.9 req/s |
| 1200 | 0.00% | 996.88ms | 722.0 req/s |
| 1400 | 0.00% | 1.45s | 715.2 req/s |
| 1600 | 0.00% | 1.91s | 706.7 req/s |
| 1800 | 0.00% | 2.36s (threshold breached) | 706.3 req/s |
| 2000 | 0.00% (but p95 threshold breached) | 2.74s | 703.7 req/s |

Key finding: Monolith maintained 0% HTTP failure rate at every 
single tested load level, including 2000 VUs - a genuinely 
remarkable result for a single t3.small instance with no 
orchestration. However, latency degrades severely and predictably 
with load: p95 climbs from 9ms at 100 VUs to 2.36s at 1800 VUs and 
2.74s at 2000 VUs, crossing the 2-second usability threshold between 
1600-1800 VUs. Throughput plateaus at approximately 700-725 req/s 
from 800 VUs onward, confirming Monolith reaches its genuine hard 
capacity ceiling through severe latency degradation rather than 
outright request rejection - the server keeps accepting and 
eventually answering every request, but response times become 
impractical for real users well before any request technically fails.

### Baseline Full-Scale Test (100-2000 VUs, in-region runner, post-MongoDB M10 upgrade)

Matching the same VU levels as the Enhanced and Monolith Full-Scale 
Tests above, for direct comparison.

| VUs | Failure rate | p95 latency | Throughput |
|-----|--------------|-------------|------------|
| 100 | 0.00% | 10.21ms | 99.2 req/s |
| 200 | 0.00% | 10.99ms | 198.0 req/s |
| 400 | 0.00% | 26.17ms | 392.1 req/s |
| 600 | 0.00% | 211.34ms | 553.1 req/s |
| 800 | 0.00% | 386.06ms | 681.9 req/s |
| 1000 | 0.00% | 730.2ms | 686.7 req/s |
| 1200 | 0.00% | 1.13s | 686.2 req/s |
| 1400 | 0.00% | 1.62s | 680.9 req/s |
| 1600 | 0.00% | 2.16s (threshold breached) | 675.6 req/s |
| 1800 | 0.00% | 2.7s (threshold breached) | 669.4 req/s |
| 2000 | 0.00% | 3.09s (threshold breached) | 668.2 req/s |

Key finding: Baseline (product-service on a single t3.micro 
instance) maintained a 0% HTTP failure rate at every single tested 
load level from 100 to 2000 VUs - matching Monolith's pattern of 
never technically failing a request despite extreme load. However, 
latency degrades severely and predictably: p95 climbs from 10ms at 
100 VUs to 3.09s at 2000 VUs, crossing the 2-second usability 
threshold between 1400-1600 VUs (earlier than Monolith's 1600-1800 
VU breach point, consistent with the t3.micro's smaller resource 
allocation compared to Monolith's t3.small). Throughput plateaus 
around 668-687 req/s from 800 VUs onward, confirming - like Monolith 
- that Baseline reaches its genuine capacity ceiling through severe 
latency degradation rather than outright request rejection.

### Resource Utilization Comparison (200/1000/2000 VUs)

Source data: `k6-tests/results/*-resources-*vu.csv` (Monolith,
Baseline) and `k6-tests/results/enhanced-resource-usage-run2.csv`
(Enhanced).

**Methodological note - Monolith/Baseline and Enhanced are NOT on the
same basis, for two separate reasons, both important:**
1. **Different measurement targets:** Monolith and Baseline figures
   are a single fixed EC2 instance's CPU/memory, sampled at three
   separate, discrete load levels (200, 1000, 2000 VUs) via host-level
   `top`-style monitoring - CPU is reported as **% of the host's total
   CPU**. Enhanced's figures are `kubectl top pods` readings for
   `product-service` pods specifically, reported in **millicores
   against each pod's 1000m CPU limit** - a different unit and a
   different denominator entirely, not just a different sampling
   method.
2. **Different test entirely, not three matched VU levels:** the only
   Enhanced pod-usage data available (`enhanced-resource-usage-run2.csv`)
   is **not** from the 200/1000/2000-VU Full-Scale Test series above -
   it predates it by roughly two days and tops out at 5 replicas,
   matching the earlier, much smaller 100-VU HPA test documented in
   Section 3, not a 2000-VU run. No Enhanced pod-usage data matching
   the actual Full-Scale Test's 1400-2000 VU scaling event (2->15
   replicas) currently exists. Rather than force this mismatched data
   into fake 200/1000/2000 VU rows, Enhanced is reported below as its
   own continuous timeline, summarized by phase (baseline / peak-load /
   post-scaling), covering its one available full load-and-scale-down
   cycle.

**Monolith and Baseline (single instance, host-level CPU%):**

| Architecture | VUs | Avg CPU% | Peak CPU% | Avg Mem (MB) | Peak Mem (MB) |
|---|---|---|---|---|---|
| Monolith (t3.small) | 200 | 15.3% | 48.4% | 315.5 | 341 |
| Monolith (t3.small) | 1000 | 50.0% | 71.0% | 341.1 | 369 |
| Monolith (t3.small) | 2000 | 57.5% | 93.9% | 397.8 | 437 |
| Baseline product-service (t3.micro) | 200 | 19.1% | 54.8% | 297.2 | 321 |
| Baseline product-service (t3.micro) | 1000 | 53.6% | 75.0% | 323.7 | 338 |
| Baseline product-service (t3.micro) | 2000 | 58.5% | 93.9% | 384.1 | 405 |

**Enhanced (per-pod, `product-service`, millicores against a 1000m
limit - separate load-and-scale cycle, not matched to the table
above):**

| Phase | Replicas | Avg CPU (m / % of limit) | Peak CPU (m / % of limit) | Avg Mem (Mi) | Peak Mem (Mi) |
|---|---|---|---|---|---|
| Baseline | 2 | 41.8m / 4.2% | 93m / 9.3% | 49.4 | 53 |
| Peak-load (scaled 2->4->5) | 5 | 49.3m / 4.9% | 99m / 9.9% | 44.9 | 53 |
| Post-scaling, 4 replicas | 4 | 5.75m / 0.6% | 8m / 0.8% | 42.0 | 49 |
| Post-scaling, 2 replicas (scale-down tail) | 2 | 3.0m / 0.3% | 3m / 0.3% | 46.0 | 49 |
| Overall (full cycle) | 2->4->5->4->2 | 51.4m / 5.1% | 99m / 9.9% | 46.1 | 54 |

Sample-size caveat: the 2-replica scale-down tail row above is drawn
from a single timestamp (`t=522`) across only 2 pods (n=2) - the
smallest sample of any row in this table, captured right at the end
of the timeline as replicas were still winding down. Its very low
CPU reading should be read as a snapshot of that specific moment, not
a statistically robust average the way the baseline/peak-load rows
(n=28 and n=35 respectively) are.

Key finding: Baseline's t3.micro runs modestly hotter than Monolith's
t3.small at equivalent VU levels (+3.8pp avg / +6.4pp peak CPU at 200
VUs, +3.6pp avg / +4.0pp peak at 1000 VUs), but the gap narrows to
nearly nothing by 2000 VUs (+1.0pp avg, peak tied at 93.9%) - both
instances are 2-vCPU, so raw CPU% is on a comparable scale throughout.
This modest CPU gap alone does not fully explain why Baseline's p95
latency crossed the 2-second usability threshold earlier than
Monolith's (1400-1600 VUs vs. 1600-1800 VUs, per the Full-Scale Test
tables above). The more likely compounding factor is memory headroom:
t3.micro has half the total RAM of t3.small (1 GiB vs. 2 GiB), so
similar absolute memory usage (297-405 MB vs. 315-437 MB) consumes a
substantially larger *fraction* of t3.micro's total capacity, on top
of t3.micro's lower baseline CPU-credit allocation under AWS's
burstable-instance model - neither effect being fully visible in a
same-instant CPU% reading. Enhanced's per-pod figures show
consistently low CPU/memory usage relative to its 1000m/512Mi
limits throughout its one available test cycle (never exceeding 9.9%
of its CPU limit, even at peak replica count), consistent with HPA
successfully distributing load across replicas rather than any single
pod being pushed toward its own resource ceiling - though this cannot
be directly compared to Monolith/Baseline's numbers above without
first correcting for the differences noted above. Notably, per-pod
CPU during peak-load (49.3m avg across 5 replicas) was *higher* than
baseline (41.8m avg across 2 replicas), not lower - confirming the
scale-up genuinely absorbed real, increased load rather than adding
idle capacity. The much lower per-pod CPU seen in the post-scaling
rows should be read as **successful load distribution across more
pods as traffic wound down at the end of the test**, not as evidence
that the earlier scale-up to 5 replicas was unnecessary - each pod
was doing proportionally less work because the same (now-decreasing)
total traffic was being shared across a larger pool of replicas, which
is exactly the intended effect of horizontal autoscaling working
correctly. **Action item:**
capture Enhanced pod-usage data during an actual 200/1000/2000-VU-
matched test run, to allow a genuinely apples-to-apples comparison.

## 6. Full User Journey Load Test (k6)

Methodology: `k6-tests/full-journey.js` (signup -> browse featured
products -> browse category -> add to cart -> view cart -> create
checkout session), 50 VUs, 3-minute duration, run against all three
architectures from the in-region EC2 runner. Full payment completion
via Stripe was scoped out (documented in `docs/decision_log.md`) -
the journey measures the complete backend flow through successful
checkout-session creation, not the browser-only payment step.

### Monolith
- Success rate: 100.00%
- p95 latency: 4.87s
- Throughput: 41.33 req/s (7,656 total requests)
- Iterations: 1,276 complete, 0 interrupted
- All 6 checks (signup, featured, category, add to cart, view cart,
  checkout session) passed at 100%

### Enhanced Microservices
Final result, after resizing product-service, order-service, AND
user-service pods to 500m/1000m CPU (see `docs/decision_log.md`) and
investigating the residual failure rate:
- Success rate: 97.81% (9,519/9,732 checks succeeded)
- Failure rate: 2.18% (213/9,732 checks failed)
- p95 latency: 358.87ms
- Throughput: 52.48 req/s
- Iterations: 1,622 complete, 0 interrupted
- **Root cause of the residual 2.18%:** investigated and ruled out
  Gateway/NLB/node-capacity as causes (all confirmed healthy/idle) -
  see `docs/decision_log.md` ("Enhanced's residual connection-reset
  failures under concurrent signup load, after pod resource resizing")
  for the full investigation. Points to the same per-process
  connection-handling limitation as Baseline's, mitigated (not
  eliminated) by Enhanced's 2-replica load distribution.

An earlier, pre-user-service-resize measurement (100.00% success,
p95 2.53s) is superseded by the final result above and no longer
reported, since it was taken before the resize that materially
changed both figures.

### Baseline Microservices
- Total requests: 7,842
- Success rate: 92.33% (7,241/7,842 checks succeeded)
- Failure rate: 7.66% (601/7,842 checks failed)
- Per-check breakdown: signup 88% (1,163/1,307 succeeded, 144
  failures, all "connection reset by peer" from user-service);
  featured/category 100%; add to cart 88% (144 failures, cascading
  from the same failed signups - `token` stays `null` on signup
  failure, so every subsequent authenticated call in that iteration
  fails too); view cart 88% (same 144); checkout session 87% (169
  failures)
- p95 latency: 2.27s
- Throughput: 42.35 req/s
- Iterations: 1,307 complete, 0 interrupted
- k6 threshold results: `p95<3000` PASSED (2.27s); `rate<0.05` FAILED
  (7.66%)
- **Root cause:** a genuine single-process connection-handling
  bottleneck on user-service, not a resource-sizing issue - see
  `docs/decision_log.md` ("Full-journey load test reveals a genuine
  single-process connection-handling bottleneck on Baseline's
  user-service") for the full investigation, including the
  independently-verified `bcryptjs` mechanism behind it.

### Comparison

| Architecture | Success rate | p95 latency | Notes |
|---|---|---|---|
| Monolith | 100.00% | 4.87s | Zero failures - single dedicated instance, no network hops, but highest latency |
| Enhanced | 97.81% | 358.87ms | Best latency by a wide margin; small residual failure rate traced to single-process-per-pod connection handling, partially mitigated by 2-replica load distribution (see decision_log.md) |
| Baseline | 92.33% | 2.27s | Same root architectural cause as Enhanced's residual failures, but more severe due to single-process (no replication) design |

Key finding: all three architectures were investigated with equal
rigor, revealing that Node.js's single-process connection-accept
limitation affects BOTH Baseline and Enhanced under this specific
bursty-signup load pattern, differing only in severity based on each
architecture's degree of horizontal replication (Baseline: 1 process,
7.66% failure; Enhanced: 2 replicas, 2.18% failure). Monolith avoids
this class of failure entirely since it never proxies signup through
a network call to a separate service - the entire journey stays
within one process. This is a genuinely nuanced finding: Enhanced's
architecture does not eliminate this bottleneck class, but
demonstrably reduces its severity through replication, while achieving
dramatically better latency than both other architectures. This
directly and precisely supports Objective 3's evaluation of resilience
under load.

## 7. WebPageTest Geographic Latency
(pending)

## 8. Inter-Service Communication Latency

### Enhanced Microservices - order-service to cart-service (clearCart)

Methodology: temporary timing instrumentation added around the
internal fetch() call in
services/order-service/src/lib/cartServiceClient.js. Deployment was
verified BEFORE measurement: both running order-service pods confirmed
to have image digest
sha256:6fbccb363b9af51a4d11727d114720da98bcb7733e9a9ab65e8dc27374baf286
(via kubectl get pods -o jsonpath), and the instrumented code was
directly confirmed present in the running container via kubectl exec
grep, before any checkout was performed. This call travels entirely
within the EKS cluster's internal network (Kubernetes Service
networking), not through the API Gateway/NLB/VPC Link.

| Call | Latency (ms) |
|------|--------------|
| 1 | 79 |
| 2 | 12 |
| 3 | 9 |
| 4 | 10 |
| 5 | 28 |
| 6 | 12 |
| 7 | 12 |
| 8 | 13 |
| 9 | 15 |
| 10 | 11 |

Median: 12ms. Average (excluding first-call outlier, likely connection
warm-up): 13.6ms. Average (all 10 samples): 20.1ms.

### Baseline Microservices - order-service to cart-service (clearCart)

Methodology: same instrumentation pattern, measuring the same
clearCart() call, but this call travels over the public internet
between two separate EC2 instances (order-service at 15.236.249.159,
cart-service at 13.37.226.159), both within the same AWS region
(eu-west-3). Deployed and verified via pm2 restart + git log
confirmation before measurement.

| Call | Latency (ms) |
|------|--------------|
| 1 | 10 |
| 2 | 6 |
| 3 | 5 |

Median: 6ms.

### Comparison and Interpretation

| Architecture | Call path | Median latency |
|---|---|---|
| Enhanced | Internal K8s cluster network (Service/kube-proxy/DNS) | 12ms |
| Baseline | Direct EC2-to-EC2, same AWS region | 6ms |

Counter-intuitively, Baseline's cross-instance call was faster than
Enhanced's internal cluster call in this sample. This is plausibly
explained by two factors: (1) both Baseline EC2 instances reside in
the same AWS region, and AWS's internal backbone network between
same-region instances can be extremely fast even when addressed via
public IPs, since traffic may not traverse the actual public internet
at all; and (2) Kubernetes Service networking (DNS resolution,
kube-proxy/iptables rules, CNI overhead) introduces genuine processing
steps that a direct HTTP connection between two EC2 instances does
not incur. This suggests that architectural abstraction layers
(Kubernetes Services) can introduce measurable overhead even for
communication that nominally stays "internal," and that raw network
topology (same-region EC2) can outperform orchestrated internal
networking for simple point-to-point calls. Sample sizes remain
modest (10 and 3 measurements respectively) - this finding should be
treated as indicative rather than conclusive, and would benefit from
a larger sample size in future work.

Note: temporary timing instrumentation was added, verified deployed,
measured, then removed on both branches. All measurements in this
section have confirmed deployment provenance (image digest / commit
SHA verified before data collection); Enhanced's provenance claim was
independently re-verified via kubectl during this session (live pod
image digest and in-container instrumented source line both matched
exactly). Baseline's provenance claim relies on the deploying
operator's account - SSH access was not available in this session to
independently re-verify it the same way.

## 9. Caching Effectiveness (Enhanced Microservices - product-service)

Methodology: tested GET /api/products/featured (a Redis cache-aside
pattern with 300s TTL, confirmed via source inspection of
product.controller.js). The Redis key (featured_products) was
explicitly deleted before each cache-miss measurement (via a temporary
redis-cli pod), guaranteeing a genuine cold-cache read from MongoDB.
Subsequent requests within the same TTL window were served from
Redis. All measurements taken from the in-region EC2 runner to avoid
local network variance (a confound discovered and corrected during
this test - initial measurements from a residential connection showed
erratic, clearly-invalid readings of 3-28 seconds, later confirmed to
be local network instability, not application or cache behavior, once
the same test was repeated cleanly from the runner).

| Type | Sample 1 | Sample 2 | Sample 3 | Sample 4 | Average |
|------|----------|----------|----------|----------|---------|
| Cache MISS (cold, key deleted) | 90.4ms | 79.9ms | 91.8ms | 93.8ms | 89.0ms |
| Cache HIT (warm, within TTL) | 59.5ms | 57.3ms | 54.9ms | 59.6ms | 57.8ms |

Result: Redis caching provided a consistent ~35% latency reduction
(89.0ms -> 57.8ms average, ~31.2ms saved per request) for the
featured-products endpoint. This is a modest but genuine, measurable
performance benefit, directly supporting Advantage (iii) claimed in
the methodology (Section 3.3.5): "the Redis caching layer intercepts
frequently accessed data before it reaches the underlying databases,
reducing redundant database round-trips." The magnitude of improvement
is smaller than some published benchmarks report (which often measure
larger, more complex queries or higher-latency database backends) -
this is consistent with MongoDB Atlas already being a fast,
well-indexed managed service for this specific, relatively small query
(featured products only), meaning the absolute headroom available for
caching to reclaim is modest. The relative improvement (~35%)
nonetheless confirms the caching layer functions correctly and
provides real, positive value.

---

Note: this file is a working log, updated as tests run. Final 
polished tables for the dissertation itself will be built from this 
data in Chapter 4.7.3.4.
