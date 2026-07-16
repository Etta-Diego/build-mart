import axios from "axios";

// Baseline Microservices has no API Gateway yet, so the frontend must
// know about and call each service directly - one base URL per service,
// as opposed to the monolith's single axios instance (frontend/src/lib/axios.js).
// See docs/DECISION_LOG.md for why this is a genuine copy of the
// frontend rather than conditional routing logic added to a shared one.
const makeApi = (baseURL) =>
	axios.create({
		baseURL: `${baseURL}/api`,
		withCredentials: true, // send cookies to the server
	});

export const productApi = makeApi(import.meta.env.VITE_PRODUCT_SERVICE_URL);
export const userApi = makeApi(import.meta.env.VITE_USER_SERVICE_URL);
export const cartApi = makeApi(import.meta.env.VITE_CART_SERVICE_URL);
export const couponApi = makeApi(import.meta.env.VITE_COUPON_SERVICE_URL);
export const orderApi = makeApi(import.meta.env.VITE_ORDER_SERVICE_URL);
