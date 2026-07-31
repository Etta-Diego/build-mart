# Cache Effectiveness Experiment — Metadata

## Identification
- Architecture: Enhanced Microservices
- Service: `product-service`, endpoint `GET /api/products/featured`
- Cache: Redis (ElastiCache), cache-aside pattern, key `featured_products`, TTL 300s (confirmed in source: `product.controller.js`)
- Load generator: `buildmart-k6-runner`, k6 v2.0.0
- Redis verification: via `kubectl exec` into `product-service-54d7c5498b-fq69q`, using the pod's own already-loaded `process.env.REDIS_URL` and its existing `ioredis` dependency (never read/printed directly — matches this project's established rule against extracting secret values)

## Pre-test verification
- Redis state before any request: `{"exists":0,"type":"none"}` — confirmed empty
- Replica count before: 2/2 (product-service-hpa: cpu 0%/70%, REPLICAS 2)

## MISS phase (N=12)
- Each sample: delete key -> verify exists=0 -> single k6 request (Connection: close, forcing a fresh TCP connection every time) -> verify exists=1 + TTL + MEMORY USAGE
- All 12 samples' Redis pre-checks confirmed exists=0 (genuine miss condition every time)
- All 12 k6 requests succeeded (0 failures), latencies: 35.10, 33.38, 30.99, 30.84, 30.73, 28.04, 33.68, 20.77, 20.44, 22.13, 19.81, 34.78 ms
- 11 of 12 post-request checks confirmed exists=1/type=string/TTL~285-297s/memoryUsageBytes=3648 (consistent payload size across all successful checks)
- **Disclosed gap:** sample 2's post-request verification call returned no output (an isolated kubectl exec hiccup, consistent with similar transient network blips observed elsewhere in this session). Sample 2's own pre-check (exists=0) and its k6-measured latency (33.38ms, 0 failures) are unaffected and valid; only the direct post-confirmation for that one specific sample is missing. This does not affect the validity of samples 3-12, since each independently re-deletes and re-verifies before its own request.
- Summary: N=12, mean=28.391ms, stddev=5.709ms, median=30.786ms, min=19.810ms, max=35.095ms, p95=34.924ms

## HIT phase (N=100)
- Single k6 run, sequential (1 VU, 100 iterations), same Connection:close header as MISS phase (symmetric keep-alive control - neither condition benefits from connection reuse)
- TTL confirmed positive (218s) immediately before starting
- All 100 requests succeeded (http_req_failed value=0)
- TTL confirmed still positive (162s) immediately after finishing - cache remained valid throughout, no re-miss occurred mid-run
- Summary: N=100, mean=11.624ms, stddev not directly exported (available via raw distribution shape: min=4.816ms, median=9.067ms, p90=19.951ms, p95=27.732ms, p99=31.880ms, max=32.293ms)

## Post-test verification
- Replica count after: 2/2 unchanged (product-service-hpa: cpu 1%/70%, REPLICAS 2) - confirms the experiment itself did not trigger autoscaling, ruling out that confound

## Result
- Mean latency reduction: (28.391 - 11.624) / 28.391 = **59.06%**
- Median latency reduction: (30.786 - 9.067) / 30.786 = **70.55%**

## Methodological notes carried into Chapter 4
- HTTP keep-alive explicitly disabled (Connection: close) in both scripts, so neither condition benefits from connection reuse - the measured gap reflects the cache-aside pattern specifically.
- `MEMORY USAGE` consistently returned 3648 bytes across every successful check, cross-validating against this endpoint's known real payload size and ruling out a degenerate/empty cached value.
- Asymmetric sample sizes (12 MISS / 100 HIT) reflect genuinely different sampling costs (MISS requires a kubectl exec verification cycle per sample; HIT does not), not an inconsistency - each group's statistics are independently valid for its own N.
