import { create } from "zustand";
import toast from "react-hot-toast";
import axios from "../lib/axios";

// Tracks the in-flight search request outside the store so a newer call
// can cancel a still-pending older one - without this, a slower earlier
// response could resolve after a faster newer one and silently overwrite
// products with a stale, mismatched result (the exact race condition
// exercised by "search again without navigating away" - see
// docs/decision_log.md).
let searchAbortController = null;

export const useProductStore = create((set) => ({
	products: [],
	loading: false,

	setProducts: (products) => set({ products }),
	createProduct: async (productData) => {
		set({ loading: true });
		try {
			const res = await axios.post("/products", productData);
			set((prevState) => ({
				products: [...prevState.products, res.data],
				loading: false,
			}));
		} catch (error) {
			toast.error(error.response.data.error);
			set({ loading: false });
		}
	},
	fetchAllProducts: async () => {
		set({ loading: true });
		try {
			const response = await axios.get("/products");
			set({ products: response.data.products, loading: false });
		} catch (error) {
			set({ error: "Failed to fetch products", loading: false });
			toast.error(error.response.data.error || "Failed to fetch products");
		}
	},
	fetchProductsByCategory: async (category) => {
		set({ loading: true });
		try {
			const response = await axios.get(`/products/category/${category}`);
			set({ products: response.data.products, loading: false });
		} catch (error) {
			set({ error: "Failed to fetch products", loading: false });
			toast.error(error.response.data.error || "Failed to fetch products");
		}
	},
	deleteProduct: async (productId) => {
		set({ loading: true });
		try {
			await axios.delete(`/products/${productId}`);
			set((prevProducts) => ({
				products: prevProducts.products.filter((product) => product._id !== productId),
				loading: false,
			}));
		} catch (error) {
			set({ loading: false });
			toast.error(error.response.data.error || "Failed to delete product");
		}
	},
	toggleFeaturedProduct: async (productId) => {
		set({ loading: true });
		try {
			const response = await axios.patch(`/products/${productId}`);
			// this will update the isFeatured prop of the product
			set((prevProducts) => ({
				products: prevProducts.products.map((product) =>
					product._id === productId ? { ...product, isFeatured: response.data.isFeatured } : product
				),
				loading: false,
			}));
		} catch (error) {
			set({ loading: false });
			toast.error(error.response.data.error || "Failed to update product");
		}
	},
	fetchFeaturedProducts: async () => {
		set({ loading: true });
		try {
			const response = await axios.get("/products/featured");
			set({ products: response.data, loading: false });
		} catch (error) {
			set({ error: "Failed to fetch products", loading: false });
			console.log("Error fetching featured products:", error);
		}
	},
	searchProducts: async (query) => {
		// Guard lives here, not in the caller - this is the one place that
		// decides whether the network is hit at all, regardless of whether
		// the caller is Navbar's debounced input or a direct visit to a bare
		// /search URL with no query.
		if (!query || !query.trim()) {
			searchAbortController?.abort();
			set({ products: [] });
			return;
		}

		// Cancel whatever search is still in flight before starting this one,
		// so an older, slower response can never land after and overwrite a
		// newer, faster one.
		searchAbortController?.abort();
		const controller = new AbortController();
		searchAbortController = controller;

		set({ loading: true });
		try {
			const response = await axios.get(`/products/search?q=${encodeURIComponent(query.trim())}`, {
				signal: controller.signal,
			});
			set({ products: response.data, loading: false });
		} catch (error) {
			if (error.code === "ERR_CANCELED") {
				return; // superseded by a newer search - not a real error
			}
			set({ error: "Failed to search products", loading: false });
			toast.error(error.response?.data?.error || "Failed to search products");
		}
	},
}));
