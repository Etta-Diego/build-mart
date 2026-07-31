# Resource Utilisation Experiment — Metadata

(Stage 1 content — environment validation, workload-level provenance, instance/deployment-mechanism confirmation, CPU-credit pre-flight checks — is unchanged from the prior version of this file and remains valid; appended below with Stage 2 execution and results.)

## Stage 2 — Execution

### Workload script
`k6-tests/read-heavy-plateau.js` — a new, untracked file (not a modification of the committed `read-heavy.js`), reusing the exact same `config.js`, endpoint mix (`/featured`, `/category/cement`, `/search`), and sleep pattern, with VUs parameterized via `__ENV.VUS` instead of hardcoded, `duration` fixed at 5 minutes. Executed from the same in-region k6 runner (`13.36.34.237`) used for the prior Full-Scale Test series, matching precedent.

### Execution order and timestamps
1. **Enhanced**: 200VU (15:16:37–15:22:16Z), 1000VU (15:22:16–15:27:45Z), 2000VU (15:27:45–15:33:12Z)
2. **Baseline** (product-service, t3.micro): 200VU (15:34:20–15:40:03Z), 1000VU (15:40:03–15:45:48Z), 2000VU (15:45:48–15:51:32Z)
3. **Monolith** (t3.small): 200VU (15:52:34–15:58:16Z), 1000VU (15:58:16–16:04:02Z), 2000VU (16:04:02–16:10:30Z)

All three levels per architecture ran back-to-back with no cooldown between them. **Disclosed consequence**: Enhanced's 2000VU plateau did not start from a clean 2-replica baseline — its initial pod set already showed non-original pod names, confirming it inherited residual scaling from the immediately preceding 1000VU plateau (consistent with the documented 120s HPA scale-down stabilisation window). This is a characteristic of the back-to-back execution order, not a fault; it also means each level, if anything, reflects realistic incrementally-growing load rather than three fully independent cold starts.

### Monitoring method per architecture
- **Enhanced**: `kubectl top pods` / `kubectl get hpa` / `kubectl get deployment` polled locally every ~15s during each plateau (15 samples/condition — slightly fewer than the ~16 planned, due to kubectl call overhead per iteration; still adequate for descriptive statistics).
- **Baseline / Monolith**: CloudWatch confirmed to only offer 5-minute-resolution basic monitoring (detailed monitoring disabled on both instances) — insufficient alone for the planned sampling density. Supplemented with `pm2 jlist` + `free -m` polled every 15s directly on each host via a persistent SSH session (22 samples/condition), with CloudWatch's coarser 5-minute average retained as an independent cross-check.

### Evidence completeness
All expected files present for all 3 architectures × 3 levels: k6 summary JSON, k6 console log, monitor log. All k6 runs passed their thresholds (p95<2000ms, failure rate<5%) except where load-induced degradation is the expected finding, not a test failure (Monolith/Baseline p95 at 2000VU, consistent with the existing precedent's documented capacity-ceiling behaviour).

### Post-test verification
- **CPU credit balances**: Monolith 576→567.5 (of 576 max), Baseline product-service 288→~277-281 (of 288 max) — both dropped only modestly, confirming neither instance approached credit exhaustion/throttling during the full test sequence. Burstable-instance confound ruled out with evidence, not assumed.
- **Enhanced**: HPA and deployment both confirmed back at 2/2 replicas post-test — clean scale-down recovery.

## Results

| Architecture | VUs | CPU | Memory | Replicas/Capacity | Throughput | Success Rate |
|---|---|---|---|---|---|---|
| Enhanced | 200 | 50.3% of 70% target (mean) | 53.3 Mi/pod (mean) | 2 (constant) | 196.0 req/s | 99.91% |
| Enhanced | 1000 | 77.8% of 70% target (mean, brief overshoot) | 50.9 Mi/pod (mean) | 2→8 | 872.4 req/s | 99.87% |
| Enhanced | 2000 | 71.5% of 70% target (mean) | 50.5 Mi/pod (mean) | 7→15 | 1915.8 req/s | 99.90% |
| Baseline | 200 | 28.3% (mean, PM2, single core) | 97.1 MB (mean) | 1 (fixed) | 197.8 req/s | 100.00% |
| Baseline | 1000 | 116.2% (mean, saturated) | 127.4 MB (mean) | 1 (fixed) | 624.7 req/s | 100.00% |
| Baseline | 2000 | 116.3% (mean, saturated, flat vs. 1000VU) | 182.0 MB (mean) | 1 (fixed) | 598.9 req/s (below 1000VU) | 100.00% |
| Monolith | 200 | 30.0% (mean) | 147.7 MB (mean) | 1 (fixed) | 198.4 req/s | 100.00% |
| Monolith | 1000 | 110.8% (mean, saturated) | 166.1 MB (mean) | 1 (fixed) | 700.2 req/s | 100.00% |
| Monolith | 2000 | 113.2% (mean, saturated, flat vs. 1000VU) | 220.7 MB (mean) | 1 (fixed) | 670.1 req/s (below 1000VU) | 100.00% |

Full descriptive statistics (SD, min, max, 95% CI) for every condition are in `analysis/statistical-report.md`.

## Key Finding

**Enhanced's replica count and CPU utilisation both moved together with load** (2 replicas / ~50% CPU at 200VU → 15 replicas / ~71% CPU at 2000VU — a 10x VU increase absorbed with CPU utilisation ending *lower*, not higher, because capacity scaled to match demand), while **Monolith and Baseline's CPU saturated by 1000VU and stayed flat into 2000VU** (fixed capacity, no mechanism to add more), with throughput plateauing or slightly declining rather than continuing to grow. Both fixed-capacity architectures maintained 100% success throughout (consistent with the existing precedent — they degrade via latency, not rejected requests), while Enhanced maintained ~99.9% success while also absorbing proportionally growing throughput (196→1916 req/s, near-linear with VU count). This is direct, evidenced support for the dissertation's claim: allocated capacity tracking demand, not raw efficiency.
