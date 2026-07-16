import { create } from "zustand";
import { userApi, productApi, cartApi, couponApi, orderApi } from "../lib/api";
import { toast } from "react-hot-toast";

export const useUserStore = create((set, get) => ({
	user: null,
	loading: false,
	checkingAuth: true,

	signup: async ({ name, email, password, confirmPassword }) => {
		set({ loading: true });

		if (password !== confirmPassword) {
			set({ loading: false });
			return toast.error("Passwords do not match");
		}

		try {
			const res = await userApi.post("/auth/signup", { name, email, password });
			set({ user: res.data, loading: false });
		} catch (error) {
			set({ loading: false });
			toast.error(error.response.data.message || "An error occurred");
		}
	},
	login: async (email, password) => {
		set({ loading: true });

		try {
			const res = await userApi.post("/auth/login", { email, password });

			set({ user: res.data, loading: false });
		} catch (error) {
			set({ loading: false });
			toast.error(error.response.data.message || "An error occurred");
		}
	},

	logout: async () => {
		try {
			await userApi.post("/auth/logout");
			set({ user: null });
		} catch (error) {
			toast.error(error.response?.data?.message || "An error occurred during logout");
		}
	},

	checkAuth: async () => {
		set({ checkingAuth: true });
		try {
			const response = await userApi.get("/auth/profile");
			set({ user: response.data, checkingAuth: false });
		} catch (error) {
			console.log(error.message);
			set({ checkingAuth: false, user: null });
		}
	},

	refreshToken: async () => {
		// Prevent multiple simultaneous refresh attempts
		if (get().checkingAuth) return;

		set({ checkingAuth: true });
		try {
			const response = await userApi.post("/auth/refresh-token");
			set({ checkingAuth: false });
			return response.data;
		} catch (error) {
			set({ user: null, checkingAuth: false });
			throw error;
		}
	},
}));

// TODO: Implement the axios interceptors for refreshing access token

// Axios interceptor for token refresh - attached to EVERY service instance,
// not just userApi. Under Baseline's stateless JWT design, each service
// independently verifies the access token and can independently return a
// 401 when it's expired - not just User/Auth Service - so a request to
// any of the five services can trigger this. The refresh call itself
// always goes through userApi (only User/Auth Service issues tokens);
// the retry replays on whichever instance the original request failed on,
// preserving that instance's own baseURL. See docs/DECISION_LOG.md.
let refreshPromise = null;

const attachAuthRefreshInterceptor = (axiosInstance) => {
	axiosInstance.interceptors.response.use(
		(response) => response,
		async (error) => {
			const originalRequest = error.config;
			if (error.response?.status === 401 && !originalRequest._retry) {
				originalRequest._retry = true;

				try {
					// If a refresh is already in progress, wait for it to complete
					if (refreshPromise) {
						await refreshPromise;
						return axiosInstance(originalRequest);
					}

					// Start a new refresh process
					refreshPromise = useUserStore.getState().refreshToken();
					await refreshPromise;
					refreshPromise = null;

					return axiosInstance(originalRequest);
				} catch (refreshError) {
					// If refresh fails, redirect to login or handle as needed
					useUserStore.getState().logout();
					return Promise.reject(refreshError);
				}
			}
			return Promise.reject(error);
		}
	);
};

[productApi, userApi, cartApi, couponApi, orderApi].forEach(attachAuthRefreshInterceptor);
