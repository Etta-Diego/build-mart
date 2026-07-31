import json
import glob
import os
import numpy as np
import pandas as pd
from scipy import stats

RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "raw")


def load_raw(phase):
    records = []
    for fp in sorted(glob.glob(os.path.join(RAW_DIR, f"{phase}_cycle_*_raw.json"))):
        with open(fp) as f:
            for line in f:
                if not line.strip():
                    continue
                point = json.loads(line)
                if point.get("type") == "Point" and point.get("metric") == "http_req_duration":
                    records.append({
                        "cycle": int(point["data"]["tags"]["cycle"]),
                        "value_ms": point["data"]["value"],
                    })
    df = pd.DataFrame(records)
    # Cycle 00 is the Stage 2 dry run (infrastructure/pipeline validation only) and
    # must be excluded from the approved 30-cycle dataset.
    return df[df["cycle"] >= 1].reset_index(drop=True)


def describe(df, label):
    v = df["value_ms"].to_numpy()
    ci = stats.t.interval(0.95, len(v) - 1, loc=v.mean(), scale=stats.sem(v))
    print(f"{label}: N={len(v)} mean={v.mean():.3f} sd={v.std(ddof=1):.3f} "
          f"median={np.median(v):.3f} p90={np.percentile(v,90):.3f} "
          f"p95={np.percentile(v,95):.3f} p99={np.percentile(v,99):.3f} "
          f"95%CI=({ci[0]:.3f},{ci[1]:.3f})")
    return {
        "N": len(v), "mean": v.mean(), "sd": v.std(ddof=1), "median": np.median(v),
        "p90": np.percentile(v, 90), "p95": np.percentile(v, 95), "p99": np.percentile(v, 99),
        "ci_lower": ci[0], "ci_upper": ci[1],
    }


def main():
    miss_df = load_raw("miss")
    hit_df = load_raw("hit")

    report_lines = []
    report_lines.append("# Cache Effectiveness Experiment v3 — Statistical Report\n")
    report_lines.append(f"Generated from raw k6 JSON output. MISS N={len(miss_df)}, HIT N={len(hit_df)}, cycles present: {sorted(miss_df['cycle'].unique())}\n")

    report_lines.append("\n## Descriptive Statistics\n")
    miss_desc = describe(miss_df, "MISS")
    hit_desc = describe(hit_df, "HIT")
    report_lines.append(f"- MISS: N={miss_desc['N']}, mean={miss_desc['mean']:.3f}ms, SD={miss_desc['sd']:.3f}, median={miss_desc['median']:.3f}, p90={miss_desc['p90']:.3f}, p95={miss_desc['p95']:.3f}, p99={miss_desc['p99']:.3f}, 95%CI=({miss_desc['ci_lower']:.3f},{miss_desc['ci_upper']:.3f})")
    report_lines.append(f"- HIT: N={hit_desc['N']}, mean={hit_desc['mean']:.3f}ms, SD={hit_desc['sd']:.3f}, median={hit_desc['median']:.3f}, p90={hit_desc['p90']:.3f}, p95={hit_desc['p95']:.3f}, p99={hit_desc['p99']:.3f}, 95%CI=({hit_desc['ci_lower']:.3f},{hit_desc['ci_upper']:.3f})")

    # --- Primary: paired, cycle-level ---
    cycle_miss = miss_df.groupby("cycle")["value_ms"].mean()
    cycle_hit_mean = hit_df.groupby("cycle")["value_ms"].mean()
    paired = pd.DataFrame({"miss": cycle_miss, "hit_mean": cycle_hit_mean}).dropna()

    wilcoxon_result = stats.wilcoxon(paired["miss"], paired["hit_mean"])
    diffs = (paired["miss"] - paired["hit_mean"]).to_numpy()
    dz = diffs.mean() / diffs.std(ddof=1)

    paired_boot = stats.bootstrap((diffs,), np.mean, confidence_level=0.95,
                                   n_resamples=10000, method="percentile", random_state=42)

    report_lines.append("\n## Primary Analysis — Paired, Cycle-Level (N=%d cycles)\n" % len(paired))
    report_lines.append(f"- Wilcoxon signed-rank: statistic={wilcoxon_result.statistic:.3f}, p={wilcoxon_result.pvalue:.6f}")
    report_lines.append(f"- Mean paired difference (MISS - HIT_mean): {diffs.mean():.3f}ms, SD={diffs.std(ddof=1):.3f}")
    report_lines.append(f"- Effect size (Cohen's dz, paired): {dz:.3f}")
    report_lines.append(f"- Paired bootstrap 95% CI on mean difference (B=10000): ({paired_boot.confidence_interval.low:.3f}, {paired_boot.confidence_interval.high:.3f})")

    # --- Secondary: pooled, request-level (NOT independent draws - clustered within cycles) ---
    mw = stats.mannwhitneyu(miss_df["value_ms"], hit_df["value_ms"], alternative="two-sided")
    welch = stats.ttest_ind(miss_df["value_ms"], hit_df["value_ms"], equal_var=False)
    pooled_boot = stats.bootstrap(
        (miss_df["value_ms"].to_numpy(), hit_df["value_ms"].to_numpy()),
        lambda x, y: np.mean(x) - np.mean(y),
        confidence_level=0.95, n_resamples=10000, method="percentile", vectorized=False, random_state=42,
    )

    report_lines.append("\n## Secondary Analysis — Pooled Request-Level (N=%d MISS, N=%d HIT)\n" % (len(miss_df), len(hit_df)))
    report_lines.append("**Caveat: HIT observations within the same cycle are not independent draws (clustered). This analysis is reported for comparability with the earlier block-designed experiment and as a robustness check only — it is NOT the primary inferential test.**\n")
    report_lines.append(f"- Mann-Whitney U: statistic={mw.statistic:.3f}, p={mw.pvalue:.6f}")
    report_lines.append(f"- Welch's t-test: statistic={welch.statistic:.3f}, df={welch.df:.3f}, p={welch.pvalue:.6f}")
    report_lines.append(f"- Pooled bootstrap 95% CI on mean difference (B=10000): ({pooled_boot.confidence_interval.low:.3f}, {pooled_boot.confidence_interval.high:.3f})")

    # --- Drift check ---
    drift_miss = stats.spearmanr(cycle_miss.index, cycle_miss.values)
    drift_hit = stats.spearmanr(cycle_hit_mean.index, cycle_hit_mean.values)

    report_lines.append("\n## Drift Check — Spearman rho (cycle index vs. per-cycle mean latency)\n")
    report_lines.append(f"- MISS: rho={drift_miss.statistic:.3f}, p={drift_miss.pvalue:.6f}")
    report_lines.append(f"- HIT: rho={drift_hit.statistic:.3f}, p={drift_hit.pvalue:.6f}")

    mean_reduction_pct = (miss_desc["mean"] - hit_desc["mean"]) / miss_desc["mean"] * 100
    median_reduction_pct = (miss_desc["median"] - hit_desc["median"]) / miss_desc["median"] * 100
    report_lines.append("\n## Summary\n")
    report_lines.append(f"- Mean latency reduction: {mean_reduction_pct:.2f}%")
    report_lines.append(f"- Median latency reduction: {median_reduction_pct:.2f}%")

    out_dir = os.path.dirname(__file__)
    miss_df.to_csv(os.path.join(out_dir, "combined-miss.csv"), index=False)
    hit_df.to_csv(os.path.join(out_dir, "combined-hit.csv"), index=False)
    paired.to_csv(os.path.join(out_dir, "paired-cycle-level.csv"))

    with open(os.path.join(out_dir, "statistical-report.md"), "w") as f:
        f.write("\n".join(report_lines) + "\n")

    print("\n".join(report_lines))


if __name__ == "__main__":
    main()
