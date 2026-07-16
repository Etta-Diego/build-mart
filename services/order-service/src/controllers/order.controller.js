import Order from "../models/order.model.js";
import { getProductsByIds, ProductServiceUnavailableError } from "../lib/productServiceClient.js";

// Replaces the monolith's Order.find(...).populate("products.product", ...)
// - Mongoose's .populate() requires the referenced model to be registered
// in the same connection, which is no longer true now that Product lives
// in its own service/database. Best-effort: if Product Service is down,
// the order is still returned with its own immutable price/quantity
// snapshot intact, just without live product name/image - a read of
// already-existing, already-paid order history is not something that
// should be hidden just because a display-enhancement dependency is
// temporarily unreachable (see docs/decision_log.md's fail-fast vs
// best-effort principle).
async function populateOrderProducts(order) {
	const productIds = [...new Set(order.products.map((item) => item.product.toString()))];
	const plainOrder = order.toObject();

	if (productIds.length === 0) {
		return plainOrder;
	}

	let products;
	try {
		products = await getProductsByIds(productIds);
	} catch (error) {
		if (error instanceof ProductServiceUnavailableError) {
			console.log("Product Service unavailable while populating order products (returning unpopulated):", error.message);
			return plainOrder;
		}
		throw error;
	}

	const productMap = new Map(products.map((p) => [p._id, p]));
	plainOrder.products = plainOrder.products.map((item) => ({
		...item,
		product: productMap.get(item.product.toString()) || item.product,
	}));

	return plainOrder;
}

export async function createOrder(session) {
	const existingOrder = await Order.findOne({ stripeSessionId: session.id });
	if (existingOrder) return existingOrder;

	const products = JSON.parse(session.metadata.products);
	const newOrder = new Order({
		user: session.metadata.userId,
		products: products.map((product) => ({
			product: product.id,
			quantity: product.quantity,
			price: product.price,
		})),
		totalAmount: session.amount_total / 100, // convert from cents to dollars
		stripeSessionId: session.id,
	});

	await newOrder.save();

	return newOrder;
}

export const getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
			return res.status(403).json({ message: "Not authorized to view this order" });
		}

		res.json(await populateOrderProducts(order));
	} catch (error) {
		console.log("Error in getOrderById controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getUserOrders = async (req, res) => {
	try {
		const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });

		res.json(await Promise.all(orders.map(populateOrderProducts)));
	} catch (error) {
		console.log("Error in getUserOrders controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
