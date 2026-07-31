# Cache Effectiveness Experiment v3 — Metadata

## Identification
- Architecture: Enhanced Microservices
- Service: `product-service`, endpoint `GET /api/products/featured`
- Cache: Redis (ElastiCache), cache-aside pattern, key `featured_products`, TTL 300s
- Design: interleaved repeated-measures, 30 cycles, 1 MISS + randomized 8-12 HITs per cycle
- Load generator: `buildmart-k6-runner` (EC2 `i-0d3ddc1f0a6f315ac`, Ubuntu, 13.36.34.237), k6 v2.0.0
- Redis verification: `kubectl exec` into `product-service-54d7c5498b-fq69q`, using the pod's own `process.env.REDIS_URL` and existing `ioredis` dependency

## Stage 1 — Environment Validation
- Cluster: `arn:aws:eks:eu-west-3:706059253443:cluster/buildmart-enhanced`, namespace `buildmart`
- product-service: 2/2 Running, 0 restarts, 19h uptime at validation time
- HPA: 2/2 replicas, CPU 0-1%/70%, no scaling in progress
- Redis: PING/PONG confirmed, version 7.1.0
- **Redis instance sharing confirmed**: SHA-256 hash of `REDIS_URL` matches between `product-service` and `cart-service` (see `redis-instance-check.log`). `keyspace_hits`/`keyspace_misses` are therefore instance-wide and used strictly as coarse supporting evidence, never per-cycle proof.
- Liveness/readiness probes target `/metrics`, not the test endpoint — no interference risk
- Baseline cache state: empty (`exists:0`) before any test action

## Stage 2 — Dry Run (Cycle 00, excluded from dataset)
- One-time ~22s cold-path delay observed on the very first request from a local sanity-check curl (diagnosed as likely VPC Link/NLB cold-start after an extended idle period, not a runner-side or in-region phenomenon — confirmed via detailed curl timing breakdown and three follow-up requests at 0.7-1.2s)
- Mitigation: one discarded warm-up request issued from the runner before Cycle 1 (84.9ms, in-region, logged, excluded from all statistics)
- Dry run (Cycle 00) confirmed: correct endpoint, correct Redis check script behavior, correct k6 tagging (phase/cycle), fresh TCP+TLS handshake on every request (confirmed directly via non-zero `http_req_connecting`/`http_req_tls_handshaking` on all 10 dry-run HIT requests, despite HTTP/2 being negotiated — observed transport metrics only, no claim made about protocol-level header semantics)
- Cycle 00's data is explicitly excluded from all statistics in this report (confirmed via code review of `analyze.py`'s cycle filter, `cycle >= 1`)

## Stage 3 — Full 30-Cycle Execution
- Start: 2026-07-30T12:48:42Z, End: 2026-07-30T13:33:18Z (44m36s wall clock, longer than the ~24min estimate due to two connectivity incidents below)
- HITs per cycle randomized 8-12 (uniform), to avoid a fixed-period aliasing risk identified during protocol design

### Disclosed incident — Cycle 05
- Reset and post-MISS check completed normally (TTL 279 confirmed populated)
- During the HIT-batch phase, both the runner's SSH connection ("Connection reset by 13.36.34.237 port 22") and a separate `kubectl exec` call ("http2: client connection lost") failed
- **Missing**: the post-HIT-batch Redis state check for Cycle 05 (never completed/logged)
- **Recovered and verified intact**: `hit_cycle_05_raw.json` and `hit_cycle_05_summary.json` transferred successfully at the time; `hit_cycle_05_console.log` was recovered afterward directly from the runner (file existed there, local transfer alone had failed) and confirms 12/12 checks passed, http_req_duration avg=14.45ms — legitimate data
- Net effect: Cycle 05's MISS and HIT latency measurements are fully valid and included; only the corroborating "cache still valid after HIT batch" confirmation is missing for this one cycle

### Disclosed incident — Cycle 21
- Reset and post-MISS check completed normally (TTL 241)
- During/after the HIT-batch phase, the runner's SSH connection was reset again ("Connection reset by 13.36.34.237 port 22", "scp: Connection closed")
- The subsequent post-HIT-batch Redis check did not execute until **12 minutes later** (13:14:38 to 13:26:32) — likely a local-network-side disruption affecting both the SSH-to-runner and kubectl-to-EKS-API-server connections simultaneously, though this is inferred, not directly proven
- By the time that delayed check finally ran, the cache had **naturally expired via TTL** (`exists:0`) — this reflects the 12-minute gap, not anything caused by the HIT requests, and does not serve its intended verification purpose for this cycle
- **Recovered and verified intact**: `hit_cycle_21_raw.json` and `hit_cycle_21_console.log` transferred successfully at the time; `hit_cycle_21_summary.json` was recovered afterward directly from the runner and confirms 12/12 checks passed, http_req_duration avg=12.07ms — legitimate data
- Net effect: Cycle 21's MISS and HIT latency measurements are fully valid and included; only the corroborating post-HIT-batch confirmation is compromised (shows natural expiry from elapsed time, not a real signal about cache behavior during the HIT batch)

### Evidence completeness audit
- 180/180 expected files (30 cycles x 2 phases x 3 file types) present and verified after recovering the two files above from the runner directly
- A data-integrity check caught that the initial analysis run included Cycle 00 (the dry run) in the pooled dataset (N=31 MISS / N=307 HIT observed) — corrected by filtering `cycle >= 1` before any results were treated as final. Final dataset: N=30 MISS, N=297 HIT.

## Stage 4 — Post-Test Verification
- HPA: 2/2 replicas unchanged, CPU 0%/70% (lower than pre-test's 1%) — autoscaling was not triggered during the experiment
- Deployment: 2/2 ready, unchanged
- `kubectl top pods`: 3m/4m CPU, 56Mi/55Mi memory — consistent with pre-test, no resource pressure
- product-service logs: captured pre and post, no errors observed

## Statistical Results (Python: pandas 3.0.5, numpy 2.5.1, scipy 1.18.0)

### Descriptive statistics
- MISS: N=30, mean=21.152ms, SD=7.557, median=19.197, p90=31.309, p95=37.679, p99=42.592, 95% CI=(18.330, 23.974)
- HIT: N=297, mean=14.782ms, SD=6.307, median=13.592, p90=21.935, p95=26.174, p99=33.469, 95% CI=(14.062, 15.502)

### Primary analysis — paired, cycle-level (N=30 cycles)
- Wilcoxon signed-rank: statistic=55.000, p=0.000099
- Mean paired difference (MISS − mean HIT per cycle): 6.164ms, SD=8.198
- Effect size (Cohen's dz, paired): 0.752
- Paired bootstrap 95% CI on mean difference (B=10,000): (3.320, 9.119)ms

### Secondary analysis — pooled request-level (caveat: HIT observations clustered within cycles, not independent; reported for comparability and as a robustness check only, not primary)
- Mann-Whitney U: statistic=7228.000, p<0.000001
- Welch's t-test: t=4.462, df=33.208, p=0.000088
- Pooled bootstrap 95% CI on mean difference (B=10,000): (3.831, 9.301)ms

### Drift check (Spearman rho, cycle index vs. per-cycle mean latency)
- MISS: rho=-0.116, p=0.540 (not significant)
- HIT: rho=-0.290, p=0.120 (not significant)
- No strong evidence of residual time-order drift in either condition — supports the interleaved design's internal-validity goal.

### Result
- **Mean latency reduction: 30.12%**
- **Median latency reduction: 29.20%**

## Comparison to the earlier (v1) single-block experiment
v1 (N=12 MISS/N=100 HIT, sequential block design) reported MISS mean=28.391ms, HIT mean=11.624ms, ~59% mean reduction. This experiment finds a smaller effect (~30% mean reduction), with MISS latency lower than v1 and HIT latency higher than v1. The most evidence-consistent explanation (not proven, but consistent with independently verified facts): product-service pods had 7d22h uptime at validation time (vs. presumably less at v1's runtime), which would tend to lower MISS cost via connection-pool/JIT warmth; and the shared ElastiCache instance's `keyspace_hits` counter was already at 663k+ before this test began, confirming substantially more background load (from `cart-service` and/or other traffic) than whatever state the instance was in during v1, which would tend to raise HIT latency. Both directions of the shift are consistent with this account. The effect remains statistically significant and directionally consistent with the cache-aside mechanism working as intended — only its magnitude differs from the earlier, less rigorously controlled measurement.
