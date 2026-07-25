// k6-tests/read-heavy.js
import http from "k6/http";
import { check, sleep } from "k6";
import { getConfig } from "./config.js";

const cfg = getConfig();

const PATTERN = __ENV.PATTERN || "constant";

const SCENARIOS = {
  ramping: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "1m", target: 50 },
      { duration: "2m", target: 50 },
      { duration: "1m", target: 0 },
    ],
  },
  constant: {
    executor: "constant-vus",
    vus: 20,
    duration: "5m",
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 5,
    stages: [
      { duration: "10s", target: 100 },
      { duration: "30s", target: 100 },
      { duration: "10s", target: 5 },
    ],
  },
};

export const options = {
  scenarios: {
    [PATTERN]: SCENARIOS[PATTERN],
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.05"],
  },
};

export default function () {
  let res = http.get(`${cfg.products}/featured`);
  check(res, { "featured: status 200": (r) => r.status === 200 });
  sleep(1);

  res = http.get(`${cfg.products}/category/cement?page=1&limit=12`);
  check(res, { "category: status 200": (r) => r.status === 200 });
  sleep(1);

  res = http.get(`${cfg.products}/search?q=cement&page=1&limit=12`);
  check(res, { "search: status 200": (r) => r.status === 200 });
  sleep(1);
}
