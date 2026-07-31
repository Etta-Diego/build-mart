# Official HPA Responsiveness Experiment — Metadata

## Identification
- Architecture: Enhanced Microservices
- Platform: Amazon EKS, namespace `buildmart`
- Target service: `product-service`
- Load generator: `buildmart-k6-runner` (13.36.34.237), k6 v2.0.0 (confirmed via `k6 version` immediately before this run)

## Configuration (confirmed live, not assumed — see hpa-before-test.txt)
- HPA: minReplicas=2, maxReplicas=20, target=70% CPU (percentage of request)
- Scale-up policy: up to 4 pods OR 100%, whichever is larger, per 15s period, 0s stabilization window
- Scale-down policy: up to 100% per 15s period, 120s stabilization window
- Pod resources (live, confirmed via jsonpath): requests 500m CPU / 256Mi, limits 1000m CPU / 512Mi (limit is exactly 2x request)
- Node capacity: 12 nodes, 1930m allocatable CPU each (23,160m total); cluster-wide CPU requests before this test: 5,300m (confirmed sufficient headroom for full maxReplicas scale-up)
- Baseline replica count confirmed via 3 independent sources immediately before test: kubectl get hpa (2), kubectl get deployment (2/2), kubectl get pods (2 Running)
- Control check: order-service-hpa also at 2/2 replicas immediately before test (isolates product-service-specific scaling from unrelated activity)

## Load generator validation
- ulimit -n on runner (default): 1024 — identified as a risk at 2000 VUs, fixed for this run via `ulimit -n 65536 &&` prefix on the k6 launch command
- Runner capacity: 2 vCPUs, 1.9GB RAM (1.4GB available) — disclosed as an unresolved capacity risk; k6's own http_req_failed/connection-error metrics in k6-summary.json are the check for whether the runner itself became a bottleneck

## Workload
- Script: official-hpa-experiment.k6.js — 3 requests per iteration (GET /featured, GET /category/cement, GET /search?q=cement), sleep(1) between each, executor: ramping-vus
- Stages: baseline 0 VUs/60s; 100/200/400/600/800/1000 VUs at 150s each; 1200/1400/1600/1800/2000 VUs at 180s each; cooldown 0 VUs/720s
- Total planned duration: ~43 minutes

## Timestamps (UTC)
- Pre-test baseline captured: see hpa-before-test.txt header (2026-07-30T07:17:15Z, retries completed shortly after)
- Monitoring terminals confirmed live before k6 start: 2026-07-30T07:25-07:26Z (see individual log headers)
- k6 run launched: 2026-07-30T07:26:38.527Z (local marker, immediately before SSH command issued)
- k6 active-load window completed: 2026-07-30T08:00:12.401Z (0 VUs reached; k6 process exited ~08:00:14Z after printing final summary)
- Cluster confirmed returned to and stable at baseline (2/2 replicas): 2026-07-30T08:00:32Z through at least 08:14:22Z (14+ minutes of continuous stability observed)
- Monitoring terminals stopped: after confirming stability, once scale-down was independently verified complete via 3 sources (hpa-watch, deployment-watch, pod-watch)

## Deviation from planned duration — disclosed, not hidden
- Planned total duration was ~43 minutes (31m12s active load + 720s scripted cooldown stage within the k6 scenario itself).
- **Actual k6 process runtime was 31m12s only** — the final scripted `{duration: "720s", target: 0}` stage did not extend the k6 process's wall-clock runtime as intended; k6 exited immediately after the ramp-down completed rather than holding for the additional 720s.
- This did NOT compromise scale-down evidence: the five Kubernetes-side monitoring processes (hpa-watch, deployment-watch, pod-watch, hpa-events, resource-monitoring) run entirely independently of the k6 process's lifecycle and continued recording after k6 exited. Scale-down was fully captured and independently confirmed stable for 14+ minutes past k6's exit.
- Limitation for the dissertation: the *design intent* (a 12-minute observation window built into the load-test script itself) was not what actually executed; the *effective* cooldown observation (independent kubectl monitoring continuing past k6's exit) achieved the same evidentiary goal by a different mechanism than planned.

## Live incidents during execution — disclosed, not hidden
1. **Watch-stream disconnections (4 separate events across Terminals 1, 2, 3, 4):** `kubectl get X --watch` connections were dropped with `"unable to decode an event from the watch stream: http2: client connection lost"` at various points between ~07:28Z and ~07:41Z. Each was detected via task-completion notifications and manual gap-checking, and restarted immediately with an auto-reconnect wrapper (`while true; do kubectl ... --watch; sleep 1; done`). Gaps are marked explicitly in each affected log file with a `=== MONITORING GAP ===` line stating the exact death and restart timestamps. No data was fabricated to fill these gaps.
   - Side effect: `hpa-events.log`'s reconnects caused `kubectl` to re-list the full existing event history on each reconnect (standard List+Watch behavior), producing duplicate entries with increasing "LAST SEEN" ages for the same underlying events. These were deduplicated when building `autoscaling-timeline.csv`, using the earliest available report of each distinct event (either directly observed at "0s" freshness, or back-calculated from a reported age when no "0s" observation exists — both cases explicitly labeled in the CSV's provenance column).
2. **Runner disk exhaustion (`buildmart-k6-runner`, /tmp filesystem):** filled to 100% (7.6GB) during the 1800-2000 VU stages because `--out json=/tmp/k6-raw.json` recorded every individual request across 600,000+ iterations. Mitigated by deleting the (already partially data-lossy) raw JSON file mid-run; since the k6 process held it open, disk space was not actually reclaimed until k6 exited, but this did not block the small `--summary-export=/tmp/k6-summary.json` file, which was confirmed written successfully (4,437 bytes) with content consistent with the console-printed summary. The per-request raw JSON export (`k6-raw.json`) is NOT available for this run as a result — this affects only k6-side request-level latency micro-analysis, not any autoscaling/replica-count claim, which came entirely from the independent Kubernetes-side logs.
3. **One pod (`product-service-54d7c5498b-hdcg6`) showed `Error` status during termination**, at 08:01:02-03Z, immediately following a `Terminating` state as part of the 6->2 scale-down. This pod ran healthy for its full ~25-minute lifetime with 0 restarts; the terminal `Error` status is consistent with the container process exiting with a non-zero code upon receiving SIGTERM (no explicit graceful-shutdown handler in the Node.js service), not an application fault during active traffic serving.

## Verified maximum replica count
**13 replicas**, reached at 2026-07-30T07:52:43.725Z (directly observed, `SuccessfulRescale: New size: 13; reason: cpu resource utilization above target`), during the 2000-VU stage. Confirmed independently via `hpa-watch.log`'s own REPLICAS column at the same time window. This is the maximum this specific experiment evidences — it is not equal to, and independently arrived at from, the previously-discarded and still-unsupported "15 replicas" claim from the earlier, evidence-free entry; any numerical proximity between the two is coincidental and does not rehabilitate the earlier claim.

## Known pre-existing context (not this experiment's result)
- A preliminary, differently-shaped smoke test (unpaced, 2-endpoint, 100 VUs, 60s) previously and independently confirmed the HPA mechanism and endpoint content can generate CPU pressure and trigger a real SuccessfulRescale event (2->6 replicas). That result is archived separately in smoke-test-validation/ and is NOT part of this experiment's dataset.
- The prior unsupported claim ("scaled from 2 to 15 replicas during the 1400-2000 VU test") is not reused here and was not independently reproduced by this experiment (this experiment's own, separately-evidenced maximum is 13, reached under a different workload shape and methodology).
