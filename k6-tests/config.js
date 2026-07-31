// k6-tests/config.js
// Select architecture via: k6 run -e ARCH=enhanced read-heavy.js
// ARCH options: enhanced | monolith | baseline

const ARCHITECTURES = {
  enhanced: {
    name: "Enhanced Microservices",
    auth: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/auth",
    products: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/products",
    cart: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/cart",
    coupons: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/coupons",
    orders: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/orders",
    payments: "https://7iuv0462q5.execute-api.eu-west-3.amazonaws.com/api/payments",
    authMode: "cookie",
  },
  monolith: {
    name: "Monolith",
    auth: "http://13.38.201.124:5000/api/auth",
    products: "http://13.38.201.124:5000/api/products",
    cart: "http://13.38.201.124:5000/api/cart",
    coupons: "http://13.38.201.124:5000/api/coupons",
    orders: "http://13.38.201.124:5000/api/orders",
    payments: "http://13.38.201.124:5000/api/payments",
    authMode: "cookie",
  },
  baseline: {
    name: "Baseline Microservices",
    auth: "http://35.181.186.152:5002/api/auth",
    products: "http://15.188.19.182:5001/api/products",
    cart: "http://13.37.226.159:5003/api/cart",
    coupons: "http://13.39.74.130:5004/api/coupons",
    orders: "http://15.236.249.159:5005/api/orders",
    payments: "http://15.236.249.159:5005/api/payments",
    authMode: "bearer",
  },
};

export function getConfig() {
  const arch = __ENV.ARCH || "monolith";
  const cfg = ARCHITECTURES[arch];
  if (!cfg) {
    throw new Error(`Unknown ARCH "${arch}". Use one of: ${Object.keys(ARCHITECTURES).join(", ")}`);
  }
  return cfg;
}
