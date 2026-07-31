# Cache Effectiveness Experiment v3 — Statistical Report

Generated from raw k6 JSON output. MISS N=30, HIT N=297, cycles present: [np.int64(1), np.int64(2), np.int64(3), np.int64(4), np.int64(5), np.int64(6), np.int64(7), np.int64(8), np.int64(9), np.int64(10), np.int64(11), np.int64(12), np.int64(13), np.int64(14), np.int64(15), np.int64(16), np.int64(17), np.int64(18), np.int64(19), np.int64(20), np.int64(21), np.int64(22), np.int64(23), np.int64(24), np.int64(25), np.int64(26), np.int64(27), np.int64(28), np.int64(29), np.int64(30)]


## Descriptive Statistics

- MISS: N=30, mean=21.152ms, SD=7.557, median=19.197, p90=31.309, p95=37.679, p99=42.592, 95%CI=(18.330,23.974)
- HIT: N=297, mean=14.782ms, SD=6.307, median=13.592, p90=21.935, p95=26.174, p99=33.469, 95%CI=(14.062,15.502)

## Primary Analysis — Paired, Cycle-Level (N=30 cycles)

- Wilcoxon signed-rank: statistic=55.000, p=0.000099
- Mean paired difference (MISS - HIT_mean): 6.164ms, SD=8.198
- Effect size (Cohen's dz, paired): 0.752
- Paired bootstrap 95% CI on mean difference (B=10000): (3.320, 9.119)

## Secondary Analysis — Pooled Request-Level (N=30 MISS, N=297 HIT)

**Caveat: HIT observations within the same cycle are not independent draws (clustered). This analysis is reported for comparability with the earlier block-designed experiment and as a robustness check only — it is NOT the primary inferential test.**

- Mann-Whitney U: statistic=7228.000, p=0.000000
- Welch's t-test: statistic=4.462, df=33.208, p=0.000088
- Pooled bootstrap 95% CI on mean difference (B=10000): (3.831, 9.301)

## Drift Check — Spearman rho (cycle index vs. per-cycle mean latency)

- MISS: rho=-0.116, p=0.540346
- HIT: rho=-0.290, p=0.120223

## Summary

- Mean latency reduction: 30.12%
- Median latency reduction: 29.20%
