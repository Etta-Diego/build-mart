import { redis } from "../lib/redis.js";
import { getProductsByIds, ProductServiceUnavailableError } from "../lib/productServiceClient.js";

// A user's cart is stored as a Redis Hash at `cart:{userId}`, field =
// productId, value = quantity - not a JSON-serialized array (see
// docs/decision_log.md for the tradeoff). This is the direct replacement
// for the monolith's cart.controller.js, which had a
// `getValidCartItems()` defensive filter to guard against cart items
// that were missing their `product` field (a real bug fixed in Phase 1 -
// see docs/DECISION_LOG.md, "cartItems was storing a broken shape").
// That defense has no equivalent here and does not need one: a hash
// field IS the product id, so there is no representable state where a
// quantity exists without a product reference - the malformed-shape bug
// class this filter guarded against cannot occur in this data structure,
// by construction.
const cartKey = (userId) => `cart:${userId}`;

export const getCartProducts = async (req, res) => {
	try {
		const cartHash = await redis.hgetall(cartKey(req.user._id));
		const productIds = Object.keys(cartHash);

		if (productIds.length === 0) {
			return res.json([]);
		}

		let products;
		try {
			products = await getProductsByIds(productIds);
		} catch (error) {
			if (error instanceof ProductServiceUnavailableError) {
				console.log("Product Service unavailable while resolving cart products:", error.message);
				return res.status(503).json({
					message: "Product Service is unavailable - could not resolve cart product details. Try again shortly.",
				});
			}
			throw error;
		}

		const cartItems = products.map((product) => ({
			...product,
			quantity: Number(cartHash[product._id]),
		}));

		res.json(cartItems);
	} catch (error) {
		console.log("Error in getCartProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const addToCart = async (req, res) => {
	try {
		const { productId } = req.body;
		await redis.hincrby(cartKey(req.user._id), productId, 1);

		const cartHash = await redis.hgetall(cartKey(req.user._id));
		const cartItems = Object.entries(cartHash).map(([product, quantity]) => ({
			product,
			quantity: Number(quantity),
		}));

		res.json(cartItems);
	} catch (error) {
		console.log("Error in addToCart controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const removeAllFromCart = async (req, res) => {
	try {
		const { productId } = req.body;
		const key = cartKey(req.user._id);

		if (!productId) {
			await redis.del(key);
		} else {
			await redis.hdel(key, productId);
		}

		const cartHash = await redis.hgetall(key);
		const cartItems = Object.entries(cartHash).map(([product, quantity]) => ({
			product,
			quantity: Number(quantity),
		}));

		res.json(cartItems);
	} catch (error) {
		console.log("Error in removeAllFromCart controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const updateQuantity = async (req, res) => {
	try {
		const { id: productId } = req.params;
		const { quantity } = req.body;
		const key = cartKey(req.user._id);

		const exists = await redis.hexists(key, productId);
		if (!exists) {
			return res.status(404).json({ message: "Product not found" });
		}

		if (quantity === 0) {
			await redis.hdel(key, productId);
		} else {
			await redis.hset(key, productId, quantity);
		}

		const cartHash = await redis.hgetall(key);
		const cartItems = Object.entries(cartHash).map(([product, quantity]) => ({
			product,
			quantity: Number(quantity),
		}));

		res.json(cartItems);
	} catch (error) {
		console.log("Error in updateQuantity controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
