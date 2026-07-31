// k6-tests/seed-accounts.js
// One-time setup script (Node.js, NOT k6) - creates the 100 pre-seeded
// test accounts required by checkout-transaction.js for a given
// architecture, and writes k6-tests/accounts/<arch>-accounts.json.
//
// Usage:  node seed-accounts.js <arch>        (arch: monolith | baseline | enhanced)
// Coupon extension:  node seed-accounts.js <arch> --with-coupon
//
// NOT executed as part of this design/prep pass - run only after explicit
// approval, since it creates 100 real user records (and, with
// --with-coupon, 100 real coupon records) in the target architecture's
// live database.

import fs from "fs";
import path from "path";

const ARCH_URLS = {
  monolith: { auth: "http://13.38.201.124:5000/api/auth", coupons: "http://13.38.201.124:5000/api/coupons", authMode: "cookie" },
  baseline: { auth: "http://35.181.186.152:5002/api/auth", coupons: "http://13.39.74.130:5004/api/coupons", authMode: "bearer" },
  enhanced: { auth: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/auth", coupons: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/coupons", authMode: "cookie" },
};

const ACCOUNT_COUNT = 100;
const PASSWORD = "K6TestPass123!";

function extractCookie(setCookieHeaders, name) {
  if (!setCookieHeaders) return null;
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const c of arr) {
    const m = c.match(new RegExp(`${name}=([^;]+)`));
    if (m) return m[1];
  }
  return null;
}

async function signupOne(cfg, index) {
  const email = `k6test_checkout_${index}@example.com`;
  const res = await fetch(`${cfg.auth}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `K6 Checkout Test ${index}`, email, password: PASSWORD }),
  });

  if (res.status !== 201) {
    const body = await res.text();
    throw new Error(`Signup failed for ${email}: ${res.status} ${body}`);
  }

  let accessCookie = null;
  if (cfg.authMode === "cookie") {
    accessCookie = extractCookie(res.headers.getSetCookie ? res.headers.getSetCookie() : res.headers.get("set-cookie"), "accessToken");
  } else {
    const body = await res.json();
    accessCookie = body.accessToken;
  }

  return { email, password: PASSWORD, _authToken: accessCookie };
}

async function issueCoupon(cfg, account) {
  const headers = { "Content-Type": "application/json" };
  if (cfg.authMode === "bearer") {
    headers.Authorization = `Bearer ${account._authToken}`;
  } else {
    headers.Cookie = `accessToken=${account._authToken}`;
  }
  const res = await fetch(`${cfg.coupons}/`, { method: "POST", headers });
  if (res.status !== 201) {
    throw new Error(`Coupon issue failed for ${account.email}: ${res.status}`);
  }
  const body = await res.json();
  return body.code;
}

async function main() {
  const arch = process.argv[2];
  const withCoupon = process.argv.includes("--with-coupon");
  const cfg = ARCH_URLS[arch];
  if (!cfg) {
    console.error(`Unknown arch "${arch}". Use one of: ${Object.keys(ARCH_URLS).join(", ")}`);
    process.exit(1);
  }

  const accounts = [];
  for (let i = 1; i <= ACCOUNT_COUNT; i++) {
    const account = await signupOne(cfg, i);
    if (withCoupon) {
      account.couponCode = await issueCoupon(cfg, account);
    }
    delete account._authToken;
    accounts.push({ email: account.email, password: account.password, ...(withCoupon ? { couponCode: account.couponCode } : {}) });
    console.log(`[${arch}] seeded ${i}/${ACCOUNT_COUNT}`);
  }

  const outDir = path.join(process.cwd(), "k6-tests", "accounts");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${arch}-accounts.json`);
  fs.writeFileSync(outPath, JSON.stringify(accounts, null, 2));
  console.log(`Wrote ${accounts.length} accounts to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
