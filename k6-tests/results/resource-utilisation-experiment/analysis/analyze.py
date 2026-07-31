import json
import os
import re
import numpy as np
from scipy import stats

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "..")
LEVELS = [200, 1000, 2000]


def describe(values, label):
    v = np.array(values, dtype=float)
    if len(v) < 2:
        print(f"{label}: N={len(v)} (insufficient for CI)")
        return
    ci = stats.t.interval(0.95, len(v) - 1, loc=v.mean(), scale=stats.sem(v))
    print(f"{label}: N={len(v)} mean={v.mean():.2f} sd={v.std(ddof=1):.2f} "
          f"min={v.min():.2f} max={v.max():.2f} 95%CI=({ci[0]:.2f},{ci[1]:.2f})")


def parse_enhanced(level):
    path = os.path.join(RESULTS_DIR, "enhanced", f"monitor_{level}vu.log")
    cpu_samples, mem_samples, replica_samples, hpa_cpu_pct = [], [], [], []
    with open(path) as f:
        lines = f.read().split("\n")
    i = 0
    while i < len(lines):
        if lines[i].startswith("==="):
            i += 1
            pod_cpu_total = 0
            pod_mem_total = 0
            n_pods = 0
            while i < len(lines) and lines[i].strip() and not lines[i].startswith("===") and "product-service-hpa" not in lines[i] and not re.match(r"^product-service\s", lines[i]):
                parts = lines[i].split()
                if len(parts) >= 3 and parts[1].endswith("m"):
                    pod_cpu_total += int(parts[1].rstrip("m"))
                    pod_mem_total += int(re.sub(r"[A-Za-z]", "", parts[2]))
                    n_pods += 1
                i += 1
            if i < len(lines) and "product-service-hpa" in lines[i]:
                m = re.search(r"cpu:\s*(\d+)%/(\d+)%", lines[i])
                if m:
                    hpa_cpu_pct.append(int(m.group(1)))
                i += 1
            if i < len(lines) and re.match(r"^product-service\s", lines[i]):
                m = re.search(r"(\d+)/(\d+)\s+(\d+)\s+(\d+)", lines[i])
                if m:
                    replica_samples.append(int(m.group(4)))
                i += 1
            if n_pods > 0:
                cpu_samples.append(pod_cpu_total)  # total millicores across all pods
                mem_samples.append(pod_mem_total / n_pods)  # avg Mi per pod
        else:
            i += 1
    return cpu_samples, mem_samples, replica_samples, hpa_cpu_pct


def parse_pm2(level, arch):
    path = os.path.join(RESULTS_DIR, arch, f"monitor_{level}vu.log")
    cpu_samples, mem_samples = [], []
    with open(path) as f:
        content = f.read()
    for m in re.finditer(r'"monit":\{"memory":(\d+),"cpu":([\d.]+)\}', content):
        mem_samples.append(int(m.group(1)) / (1024 * 1024))  # bytes -> MB
        cpu_samples.append(float(m.group(2)))
    return cpu_samples, mem_samples


def load_k6_summary(arch, level):
    path = os.path.join(RESULTS_DIR, arch, f"{arch}_{level}vu_summary.json")
    with open(path) as f:
        d = json.load(f)
    m = d["metrics"]
    total = m["checks_total"]["count"] if "checks_total" in m else m["http_reqs"]["count"]
    failed_rate = m.get("http_req_failed", {}).get("value", None)
    success_rate = (1 - failed_rate) * 100 if failed_rate is not None else None
    return {
        "throughput": m["http_reqs"]["rate"],
        "success_rate": success_rate,
        "total_requests": m["http_reqs"]["count"],
    }


def main():
    report = ["# Resource Utilisation Experiment - Statistical Report\n"]

    for arch in ["enhanced", "baseline", "monolith"]:
        report.append(f"\n## {arch.capitalize()}\n")
        for level in LEVELS:
            report.append(f"\n### {level} VUs\n")
            if arch == "enhanced":
                cpu, mem, replicas, hpa_pct = parse_enhanced(level)
                print(f"\n--- {arch} {level}VU ---")
                describe(cpu, f"Total pod CPU (millicores)")
                describe(mem, f"Avg pod memory (Mi)")
                describe(hpa_pct, f"HPA-reported CPU %")
                if replicas:
                    print(f"Replica count range: {min(replicas)}-{max(replicas)}")
                report.append(f"- Total pod CPU (millicores): N={len(cpu)}, mean={np.mean(cpu):.1f}, sd={np.std(cpu, ddof=1):.1f}\n")
                report.append(f"- Avg pod memory (Mi): mean={np.mean(mem):.1f}\n")
                report.append(f"- HPA CPU%: mean={np.mean(hpa_pct):.1f}\n")
                report.append(f"- Replica count range: {min(replicas)}-{max(replicas)}\n")
            else:
                cpu, mem = parse_pm2(level, arch)
                print(f"\n--- {arch} {level}VU ---")
                describe(cpu, "PM2 process CPU %")
                describe(mem, "PM2 process memory (MB)")
                report.append(f"- PM2 CPU%: N={len(cpu)}, mean={np.mean(cpu):.2f}, sd={np.std(cpu, ddof=1):.2f}\n")
                report.append(f"- PM2 memory (MB): mean={np.mean(mem):.1f}\n")

            k6 = load_k6_summary(arch, level)
            print(f"Throughput: {k6['throughput']:.1f} req/s, Success rate: {k6['success_rate']:.2f}%")
            report.append(f"- Throughput: {k6['throughput']:.1f} req/s\n")
            report.append(f"- Success rate: {k6['success_rate']:.2f}%\n")

    with open(os.path.join(os.path.dirname(__file__), "statistical-report.md"), "w") as f:
        f.write("".join(report))


if __name__ == "__main__":
    main()
