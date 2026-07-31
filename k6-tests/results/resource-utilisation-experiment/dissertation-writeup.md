# Resource Utilisation Experiment — Chapter 4 Write-Up

## Methodology

To evaluate whether the Enhanced Microservices architecture demonstrates improved cloud-native resource management — rather than lower raw computational cost — a resource-utilisation experiment measured CPU utilisation, memory utilisation, allocated capacity (replica or instance count), throughput, and request success rate across three sustained workload plateaus (200, 1000, and 2000 virtual users) for each of the Monolithic, Baseline Microservices, and Enhanced Microservices architectures. These workload levels were not newly defined for this experiment: they were reused directly from an existing resource-utilisation comparison already present in the project's benchmark records, which had explicitly disclosed that its Enhanced-architecture data was not actually matched to those levels. This experiment closes that specific, previously-documented gap rather than introducing a new measurement axis.

Each workload plateau ran for five minutes; the first 60 seconds were discarded as a warm-up/stabilisation period (covering application, cache, and HPA-reaction transients), and the remaining four minutes were sampled at 15-second intervals. Because raw CPU and memory percentages are measured against fundamentally different capacity bases across the three architectures — Amazon EC2 instance-level percentage (Monolith, Baseline), Kubernetes pod-level percentage of a configured limit (Enhanced) — this experiment does not compare absolute utilisation values numerically across architectures. Instead, each architecture's utilisation is analysed as a trend against its own load levels: whether allocated capacity adapts to rising demand, or utilisation climbs toward saturation under a fixed footprint. Two mandatory pre-flight checks preceded execution: (1) confirmation that Monolith (t3.small) and Baseline's product-service (t3.micro) — both AWS burstable T-family instances — held a full CPU credit balance before testing, to rule out AWS's credit-throttling mechanism as a confound unrelated to architecture; and (2) confirmation of each architecture's actual resource-monitoring mechanism rather than an assumed one, which revealed that Monolith and Baseline's product-service both run as PM2-managed Node processes on dedicated EC2 instances (not containers), requiring supplementary 15-second `pm2`/`free` polling alongside CloudWatch, since EC2 detailed monitoring was found to be disabled (5-minute resolution only) on both instances.

Given the small number of discrete, engineered load levels (three per architecture) rather than a sampled continuum, descriptive statistics (mean, standard deviation, minimum, maximum, 95% confidence interval) are reported as the primary and sufficient analytical layer. Formal inferential testing was considered and deliberately excluded: a rank correlation computed across all raw samples would commit pseudo-replication (only three truly distinct conditions exist, not dozens of independent ones), while the same test computed on three condition-level means would be critically underpowered to produce a meaningful result. The trend claims in this experiment are supported by the reported descriptive values directly, not by a manufactured significance test.

## Results

**Enhanced (Kubernetes pods, product-service, 1000m CPU limit, HPA target 70%):**

| VUs | Replica range | Mean total pod CPU (millicores) | Mean HPA CPU% (of 70% target) | Mean pod memory (Mi) | Throughput | Success rate |
|---|---|---|---|---|---|---|
| 200 | 2 (constant) | 510.1 (SD 140.2) | 50.3% (SD 13.9) | 53.3 | 196.0 req/s | 99.91% |
| 1000 | 2→8 | 2164.2 (SD 821.0) | 77.8% (SD 51.7) | 50.9 | 872.4 req/s | 99.87% |
| 2000 | 7→15 | 4564.1 (SD 1526.2) | 71.5% (SD 30.3) | 50.5 | 1915.8 req/s | 99.90% |

**Baseline (product-service, dedicated t3.micro EC2, PM2 single fork instance):**

| VUs | Mean PM2 CPU% | Mean PM2 memory (MB) | Throughput | Success rate |
|---|---|---|---|---|
| 200 | 28.3% (SD 13.3) | 97.1 | 197.8 req/s | 100.00% |
| 1000 | 116.2% (SD 38.3) | 127.4 | 624.7 req/s | 100.00% |
| 2000 | 116.3% (SD 41.3) | 182.0 | 598.9 req/s | 100.00% |

**Monolith (single t3.small EC2, PM2 single fork instance):**

| VUs | Mean PM2 CPU% | Mean PM2 memory (MB) | Throughput | Success rate |
|---|---|---|---|---|
| 200 | 30.0% (SD 10.0) | 147.7 | 198.4 req/s | 100.00% |
| 1000 | 110.8% (SD 36.1) | 166.1 | 700.2 req/s | 100.00% |
| 2000 | 113.2% (SD 34.8) | 220.7 | 670.1 req/s | 100.00% |

Pre- and post-test CPU credit balance checks (Monolith: 576→567.5 of 576 maximum; Baseline: 288→~277-281 of 288 maximum) confirmed neither burstable instance approached credit exhaustion during the test sequence. Enhanced's HPA and deployment were confirmed back at 2/2 replicas following the test, indicating a complete scale-down recovery.

## Discussion

The Enhanced architecture's allocated capacity visibly tracked demand: replica count rose from a constant 2 at 200 VUs to a range of 7–15 at 2000 VUs, and mean CPU utilisation — rather than climbing under a ten-fold increase in load — ended lower at 2000 VUs (71.5%) than its brief overshoot at 1000 VUs (77.8%), settling near its configured 70% target throughout. This is evidence of adaptive resource management: allocated capacity responded to workload demand through Kubernetes' Horizontal Pod Autoscaler, keeping utilisation within a bounded, self-regulating range rather than allowing it to climb unchecked.

By contrast, both Monolith and Baseline — architectures with fixed, unchangeable capacity for the duration of the test — show CPU utilisation saturating by 1000 VUs (110.8% and 116.2% respectively, both exceeding 100% of a single CPU core's capacity under PM2's reporting convention) and remaining essentially flat into 2000 VUs (113.2%, 116.3%), with throughput plateauing or mildly declining rather than continuing to grow (Monolith: 700.2→670.1 req/s; Baseline: 624.7→598.9 req/s). Memory, reported here as a raw curve rather than forced into a per-request ratio, rose steadily with load for both fixed-capacity architectures (Monolith: 147.7→220.7 MB; Baseline: 97.1→182.0 MB) while remaining essentially flat for Enhanced's individual pods (53.3→50.5 Mi) — because Enhanced added new pods rather than growing existing ones, itself a further indicator of capacity-based rather than per-instance scaling.

This experiment does not claim that the Enhanced architecture consumes less CPU or memory, and no such comparison is drawn between architectures in absolute terms. What it demonstrates is that Enhanced's Kubernetes-orchestrated capacity dynamically adjusts to workload demand — evidenced by the relationship between rising workload, HPA-driven replica adjustment, and maintained, bounded resource utilisation — while the Monolith and Baseline architectures, lacking any such mechanism, absorb increasing demand entirely within a fixed footprint until that footprint saturates. Notably, all three architectures maintained near-100% request success rates throughout, meaning the fixed-capacity architectures did not fail outright under saturation; they degraded through worsening latency instead, consistent with this project's existing precedent findings. The distinguishing evidence for Enhanced is not that it avoided failure — none of the three architectures failed — but that it avoided saturation altogether at load levels that saturated the other two.

## Limitations

- Raw CPU and memory percentages are not compared numerically across architectures, by deliberate design, given their incommensurable capacity bases (EC2 instance-level vs. Kubernetes pod-level percentages). This is a scope boundary, not an omission.
- The three workload levels were executed back-to-back per architecture with no cooldown period between them. This means Enhanced's 2000VU plateau did not begin from a clean 2-replica baseline — it inherited residual scaling from the immediately preceding 1000VU plateau, consistent with the platform's documented HPA scale-down stabilisation window. This is disclosed rather than concealed, and arguably reflects a realistic scenario of continuously growing demand rather than three independent cold starts.
- Baseline's product-service runs on a single dedicated t3.micro EC2 instance, distinct from Monolith's t3.small — an existing, previously-documented asymmetry in this project's infrastructure, not introduced by this experiment.
- Node co-tenancy on shared Kubernetes worker nodes is a second-order threat to pod-level CPU isolation not fully eliminated by cgroup quotas, though not directly observed as a factor here.
- Monolith and Baseline were evaluated using PM2's own CPU reporting convention (percentage of a single core, capable of exceeding 100%), supplementing CloudWatch's coarser 5-minute host-level percentage; the two measures were not formally reconciled into a single unit beyond confirming they moved in the same direction.

## Threats to Validity

**Internal validity.** Burstable-instance CPU-credit exhaustion was checked explicitly before and after testing and ruled out as a confound. Each architecture's actual resource-monitoring mechanism was verified directly (not assumed) before data collection began.

**Construct validity.** The research question concerns whether allocated capacity adapts to demand, not which architecture is more computationally efficient — the metrics and analysis (within-architecture trends, no cross-architecture percentage comparison) are chosen specifically to reflect that scope, and the Discussion section is written to avoid any implication that Kubernetes is faster or uses fewer resources.

**External validity.** Findings are scoped to the specific endpoint mix and the 200/1000/2000 VU range tested; behaviour at load levels beyond 2000 VUs, or for different endpoint mixes, was not evaluated in this experiment (though the existing Full-Scale Test series provides latency/throughput data up to 2000 VUs for additional context).
