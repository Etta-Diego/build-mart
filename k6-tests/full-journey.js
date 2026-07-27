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

export default function () {
  const journeyStart = Date.now();
  const uniqueId = `${__VU}_${__ITER}_${Date.now()}`;
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

  // Full payment completion is not simulated, as Stripe Checkout
  // Sessions require browser-based interaction to complete by design
  // (PCI compliance) - this measures the complete backend journey
  // through checkout-session creation.
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
