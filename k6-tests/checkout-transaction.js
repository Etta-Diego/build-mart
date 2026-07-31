// k6-tests/checkout-transaction.js
// End-to-End Customer Checkout Transaction Performance Evaluation
// Select architecture via: k6 run -e ARCH=enhanced -e VUS=25 checkout-transaction.js
// Optional coupon extension: -e COUPON=1
//
// Transaction boundary: successful checkout-session creation (not payment
// settlement). See docs/decision_log.md for why this boundary was chosen.

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { getConfig } from "./config.js";

const cfg = getConfig();
const VUS = parseInt(__ENV.VUS || "25", 10);
const USE_COUPON = __ENV.COUPON === "1";
const ACCOUNTS = JSON.parse(open(`./accounts/${__ENV.ARCH || "monolith"}-accounts.json`));

// Deterministic, reproducible search-term rotation - avoids every VU/iteration
// issuing the identical query (which would understate real search diversity
// and risk an unrepresentative best-case latency if any layer between here
// and the database treats a repeated identical query differently). Selection
// is a pure function of __VU, not random, so results are reproducible across
// re-runs of the same VU count.
//
// Every term below was verified directly against all three architectures'
// product catalogues (identical across all three) to return at least one
// result before being included here. The original list included "brick" and
// "tile", which both return zero results in this dataset - that caused a
// silent, non-check-visible product_discovery failure (productId stays null
// despite a 200 response) for every VU mapped to those terms, which is what
// produced Monolith's 25VU run showing checks_failed=0% alongside
// transaction_success_rate=36.81%: a fixture-data bug, not an architectural
// finding. See docs/decision_log.md.
const SEARCH_TERMS = ["cement", "paint", "wood", "sand", "steel", "pipe", "roofing"];

// Fails the whole test at init time (before any VU runs), not per-iteration -
// a per-iteration failure would let the test proceed with the coupon field
// silently absent from most iterations, producing a "coupon-enabled" dataset
// that is actually indistinguishable from the no-coupon condition. Checked
// against every seeded account so a partially-seeded accounts.json (e.g. a
// stale file from before --with-coupon was used) is caught immediately.
if (USE_COUPON) {
  const missing = ACCOUNTS.filter((a) => !a.couponCode).length;
  if (missing > 0) {
    throw new Error(
      `COUPON=1 was set but ${missing}/${ACCOUNTS.length} accounts in ` +
      `./accounts/${__ENV.ARCH || "monolith"}-accounts.json have no couponCode. ` +
      `Reseed with --with-coupon before running the coupon-enabled condition.`
    );
  }
}

const successDuration = new Trend("successful_transaction_duration");
const failedDuration = new Trend("failed_transaction_duration");
const transactionSuccess = new Rate("transaction_success_rate");

export const options = {
  scenarios: {
    checkout_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: VUS },
        { duration: "285s", target: VUS },
      ],
    },
  },
  // No pass/fail latency threshold on successful_transaction_duration - the
  // workflow deliberately includes ~5s of sleep() think-time per iteration
  // (simulating realistic customer pacing, per the approved methodology), so
  // any fixed millisecond cutoff would be measuring the sleep design choice,
  // not architectural behaviour. A p95<3000ms threshold from the dry run
  // failed on all three architectures for exactly this reason - it was
  // unachievable by construction, not a signal of slowness. Reporting the
  // full distribution (avg/median/p95/p99/max) is the correct output for a
  // descriptive-statistics comparison; a normative pass/fail cutoff isn't
  // part of this experiment's research question. transaction_success_rate
  // remains a real threshold below, since a functional failure is a
  // meaningful signal, unlike duration.
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: {
    transaction_success_rate: ["rate>0.95"],
  },
};

function getAuthHeaders(token) {
  if (cfg.authMode === "bearer") {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export default function () {
  const account = ACCOUNTS[(__VU - 1) % ACCOUNTS.length];
  const start = Date.now();
  let token = null;
  let ok = true;

  ok = group("login", () => {
    const res = http.post(
      `${cfg.auth}/login`,
      JSON.stringify({ email: account.email, password: account.password }),
      { headers: { "Content-Type": "application/json" } }
    );
    if (cfg.authMode === "bearer" && res.status === 200) {
      token = JSON.parse(res.body).accessToken;
    }
    return check(res, { "login: status 200": (r) => r.status === 200 });
  });
  if (!ok) {
    transactionSuccess.add(false);
    failedDuration.add(Date.now() - start);
    return;
  }

  let productId = null;
  ok = group("product_discovery", () => {
    let res = http.get(`${cfg.products}/featured`, { headers: getAuthHeaders(token) });
    const featuredOk = check(res, { "featured: status 200": (r) => r.status === 200 });
    sleep(1);

    // NOTE: "View Product Details" is intentionally NOT a separate HTTP
    // call here - this application has no dedicated product-detail
    // endpoint or page (verified: no GET /products/:id route, no
    // ProductPage.jsx). Product cards are added to cart directly from
    // list views in the real app, so an extra network round-trip here
    // would not reflect actual user behaviour. Flagged for your review;
    // recommended default is to omit it, consistent with the real app.
    const searchTerm = SEARCH_TERMS[(__VU - 1) % SEARCH_TERMS.length];
    res = http.get(`${cfg.products}/search?q=${searchTerm}`, { headers: getAuthHeaders(token) });
    const searchOk = check(res, { "search: status 200": (r) => r.status === 200 });
    if (res.status === 200) {
      const body = JSON.parse(res.body);
      const products = body.data || body.products || body;
      if (Array.isArray(products) && products.length > 0) {
        productId = products[0]._id;
      }
    }
    sleep(1);
    return featuredOk && searchOk && productId !== null;
  });
  if (!ok) {
    transactionSuccess.add(false);
    failedDuration.add(Date.now() - start);
    return;
  }

  ok = group("cart", () => {
    const addRes = http.post(
      `${cfg.cart}/`,
      JSON.stringify({ productId }),
      { headers: { "Content-Type": "application/json", ...getAuthHeaders(token) } }
    );
    const addOk = check(addRes, { "add to cart: status 200": (r) => r.status === 200 });
    sleep(1);

    const viewRes = http.get(`${cfg.cart}/`, { headers: getAuthHeaders(token) });
    const viewOk = check(viewRes, { "view cart: status 200": (r) => r.status === 200 });
    sleep(1);
    return addOk && viewOk;
  });
  if (!ok) {
    transactionSuccess.add(false);
    failedDuration.add(Date.now() - start);
    clearCart(token);
    return;
  }

  const checkoutOk = group("checkout", () => {
    const payload = {
      products: [{ _id: productId, quantity: 1, price: 10, name: "Test Product" }],
    };
    if (USE_COUPON) {
      payload.couponCode = ACCOUNTS[(__VU - 1) % ACCOUNTS.length].couponCode;
    }
    const res = http.post(
      `${cfg.payments}/create-checkout-session`,
      JSON.stringify(payload),
      { headers: { "Content-Type": "application/json", ...getAuthHeaders(token) } }
    );
    return check(res, { "checkout session: status 200": (r) => r.status === 200 });
  });

  const elapsed = Date.now() - start;
  transactionSuccess.add(checkoutOk);
  if (checkoutOk) {
    successDuration.add(elapsed);
  } else {
    failedDuration.add(elapsed);
  }

  // Cleanup only - excluded from `elapsed` above.
  clearCart(token);
  sleep(1);
}

function clearCart(token) {
  http.del(`${cfg.cart}/`, null, { headers: getAuthHeaders(token) });
}
