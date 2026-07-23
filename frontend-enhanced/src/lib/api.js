import axios from "axios";

const GATEWAY_URL = import.meta.env.VITE_API_GATEWAY_URL;

const makeApi = (resourcePath) =>
	axios.create({
		baseURL: `${GATEWAY_URL}/api/${resourcePath}`,
		withCredentials: true, // send cookies to the server
	});

export const productApi = makeApi("products");
export const userApi = makeApi("auth");
export const cartApi = makeApi("cart");
export const couponApi = makeApi("coupons");
export const orderApi = makeApi("orders");
