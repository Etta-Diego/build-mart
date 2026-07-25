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

## 6. Full User Journey Load Test (k6)
(pending - script not yet built)

## 7. WebPageTest Geographic Latency
(pending)

---

Note: this file is a working log, updated as tests run. Final 
polished tables for the dissertation itself will be built from this 
data in Chapter 4.7.3.4.
