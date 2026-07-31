// k6-tests/cdn-cache-hit.js
// CDN Performance Evaluation - Experiment 1: CloudFront cache-HIT sustained load.
// Measures steady-state edge-cache-hit delivery latency for the Enhanced
// frontend's static assets (index.html, JS bundle, CSS bundle, a static
// image), served entirely from CloudFront's edge cache. This is the
// counterpart to cdn-cache-miss.js, which measures the miss condition via
// invalidation cycles instead (a sustained miss cannot exist for identical
// requests - the first miss immediately repopulates the cache).
//
// Frontend-only: no backend API endpoints are exercised here.

import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = "https://d1iyf15c0shdw7.cloudfront.net";
const ASSETS = ["/index.html", "/assets/index-Cz7Ta8rM.js", "/assets/index-B61W4Q95.css", "/vite.svg"];

const hitLatency = new Trend("cdn_hit_latency");
const hitSuccess = new Rate("cdn_hit_success_rate");
const notAHit = new Rate("cdn_confirmed_hit_rate");

export const options = {
  scenarios: {
    cdn_hit_load: {
      executor: "constant-vus",
      vus: 20,
      duration: "3m",
    },
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    cdn_hit_success_rate: ["rate>0.95"],
  },
};

export default function () {
  const path = ASSETS[__VU % ASSETS.length];
  const res = http.get(`${BASE}${path}`);

  const ok = check(res, { "status 200": (r) => r.status === 200 });
  hitSuccess.add(ok);
  if (ok) hitLatency.add(res.timings.duration);

  const cacheHeader = res.headers["X-Cache"] || "";
  notAHit.add(cacheHeader.toLowerCase().includes("hit from cloudfront"));
}
