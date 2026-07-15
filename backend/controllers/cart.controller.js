import Product from "../models/product.model.js";

// Defensive against pre-existing cart items saved before addToCart correctly
// set `product` (see docs/DECISION_LOG.md) - skips and warns instead of
// crashing on any item missing a valid product reference.
function getValidCartItems(cartItems) {
	return cartItems.filter((item) => {
		if (!item.product) {
			console.log("Warning: skipping malformed cart item (missing product field):", JSON.stringify(item));
			return false;
		}
		return true;
	});
}

export const getCartProducts = async (req, res) => {
	try {
		const validCartItems = getValidCartItems(req.user.cartItems);
		const productIds = validCartItems.map((item) => item.product);
		const products = await Product.find({ _id: { $in: productIds } });

		// add quantity for each product
		const cartItems = products.map((product) => {
			const item = validCartItems.find((cartItem) => cartItem.product.toString() === product.id);
			return { ...product.toJSON(), quantity: item.quantity };
		});

		res.json(cartItems);
	} catch (error) {
		console.log("Error in getCartProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const addToCart = async (req, res) => {
	try {
		const { productId } = req.body;
		const user = req.user;

		const validCartItems = getValidCartItems(user.cartItems);
		const existingItem = validCartItems.find((item) => item.product.toString() === productId);
		if (existingItem) {
			existingItem.quantity += 1;
		} else {
			user.cartItems.push({ product: productId, quantity: 1 });
		}

		await user.save();
		res.json(user.cartItems);
	} catch (error) {
		console.log("Error in addToCart controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const removeAllFromCart = async (req, res) => {
	try {
		const { productId } = req.body;
		const user = req.user;
		if (!productId) {
			user.cartItems = [];
		} else {
			user.cartItems = getValidCartItems(user.cartItems).filter((item) => item.product.toString() !== productId);
		}
		await user.save();
		res.json(user.cartItems);
	} catch (error) {
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const updateQuantity = async (req, res) => {
	try {
		const { id: productId } = req.params;
		const { quantity } = req.body;
		const user = req.user;
		const validCartItems = getValidCartItems(user.cartItems);
		const existingItem = validCartItems.find((item) => item.product.toString() === productId);

		if (existingItem) {
			if (quantity === 0) {
				user.cartItems = validCartItems.filter((item) => item.product.toString() !== productId);
				await user.save();
				return res.json(user.cartItems);
			}

			existingItem.quantity = quantity;
			await user.save();
			res.json(user.cartItems);
		} else {
			res.status(404).json({ message: "Product not found" });
		}
	} catch (error) {
		console.log("Error in updateQuantity controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
