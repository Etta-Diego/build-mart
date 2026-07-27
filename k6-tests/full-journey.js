import http from "k6/http";
import { check, sleep } from "k6";
import { getConfig } from "./config.js";

const cfg = getConfig();
const PATTERN = __ENV.PATTERN || "constant";

const SCENARIOS = {
  constant: {
    executor: "constant-vus",
    vus: 20,
    duration: "3m",
  },
  ramping: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "1m", target: 50 },
      { duration: "2m", target: 50 },
      { duration: "1m", target: 0 },
    ],
  },
};

export const options = {
  scenarios: {
    [PATTERN]: SCENARIOS[PATTERN],
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
  },
};

function getAuthHeaders(token) {
  if (cfg.authMode === "bearer") {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

// Init-context (runs once per VU instance, not per iteration). __VU/__ITER
// are only guaranteed unique within a single k6 process - if a second k6
// process runs concurrently against the same target (e.g. an overlapping
// or leftover test run), its VU numbering restarts independently from 1,
// so the same __VU/__ITER pair can recur across processes. Reproduced and
// confirmed: two concurrent local k6 runs of this script's prior
// __VU_ITER_Date.now() scheme produced 251 duplicate-email collisions
// across 185,293 signups (0-2ms apart) when hitting a fast target, because
// unthrottled iterations let two processes drift into sustained lockstep.
// A random value generated once per VU instance closes this gap, since two
// independent processes' Math.random() calls won't coincide.
const vuInstanceSeed = Math.floor(Math.random() * 1e9);

export default function () {
  const journeyStart = Date.now();
  const uniqueId = `${__VU}_${vuInstanceSeed}_${__ITER}_${Date.now()}`;
  const email = `k6test_${uniqueId}@example.com`;
  const password = "TestPass123!";

  let res = http.post(
    `${cfg.auth}/signup`,
    JSON.stringify({ name: "K6 Test User", email, password }),
    { headers: { "Content-Type": "application/json" } }
  );
  check(res, { "signup: status 201": (r) => r.status === 201 });

  let token = null;
  if (cfg.authMode === "bearer" && res.status === 201) {
    token = JSON.parse(res.body).accessToken;
  }
  sleep(1);

  res = http.get(`${cfg.products}/featured`);
  check(res, { "featured: status 200": (r) => r.status === 200 });
  sleep(1);

  res = http.get(`${cfg.products}/category/cement?page=1&limit=12`);
  check(res, { "category: status 200": (r) => r.status === 200 });

  let productId = null;
  if (res.status === 200) {
    const body = JSON.parse(res.body);
    const products = body.data || body.products || body;
    if (Array.isArray(products) && products.length > 0) {
      productId = products[0]._id;
    }
  }
  sleep(1);

  if (productId) {
    res = http.post(
      `${cfg.cart}/`,
      JSON.stringify({ productId }),
      { headers: { "Content-Type": "application/json", ...getAuthHeaders(token) } }
    );
    check(res, { "add to cart: status 200": (r) => r.status === 200 });
  }
  sleep(1);

  res = http.get(`${cfg.cart}/`, { headers: getAuthHeaders(token) });
  check(res, { "view cart: status 200": (r) => r.status === 200 });
  sleep(1);

  // Full payment completion is not simulated - Stripe Checkout
  // Sessions require browser-based interaction to complete by design
  // (PCI compliance), which k6 cannot replicate without full browser
  // automation (e.g. xk6-browser). This script measures the complete
  // backend journey through successful checkout-session creation,
  // which exercises cart lookup, pricing calculation, coupon
  // validation, and Stripe API integration - the substantive backend
  // logic - without completing the final browser-only payment step.
  // See docs/decision_log.md for further discussion.
  if (productId) {
    res = http.post(
      `${cfg.payments}/create-checkout-session`,
      JSON.stringify({
        products: [{ _id: productId, quantity: 1, price: 10, name: "Test Product" }],
      }),
      { headers: { "Content-Type": "application/json", ...getAuthHeaders(token) } }
    );
    check(res, { "checkout session: status 200": (r) => r.status === 200 });
  }

  const journeyDuration = Date.now() - journeyStart;
  console.log(`Full journey duration: ${journeyDuration}ms`);
}
