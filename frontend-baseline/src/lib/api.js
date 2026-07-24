import axios from "axios";

// Baseline Microservices has no API Gateway yet, so the frontend must
// know about and call each service directly - one base URL per service,
// as opposed to the monolith's single axios instance (frontend/src/lib/axios.js).
// See docs/DECISION_LOG.md for why this is a genuine copy of the
// frontend rather than conditional routing logic added to a shared one.
const makeApi = (baseURL) => {
	const instance = axios.create({
		baseURL: `${baseURL}/api`,
	});

	// Attaches the current access token as Authorization: Bearer (not a
	// cookie - see docs/DECISION_LOG.md) to every outgoing request, if one
	// is present in localStorage.
	instance.interceptors.request.use((config) => {
		const accessToken = localStorage.getItem("accessToken");
		if (accessToken) {
			config.headers.Authorization = `Bearer ${accessToken}`;
		}
		return config;
	});

	return instance;
};

export const productApi = makeApi(import.meta.env.VITE_PRODUCT_SERVICE_URL);
export const userApi = makeApi(import.meta.env.VITE_USER_SERVICE_URL);
export const cartApi = makeApi(import.meta.env.VITE_CART_SERVICE_URL);
export const couponApi = makeApi(import.meta.env.VITE_COUPON_SERVICE_URL);
export const orderApi = makeApi(import.meta.env.VITE_ORDER_SERVICE_URL);
