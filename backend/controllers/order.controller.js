import Order from "../models/order.model.js";
import { parsePagination, paginatedResponse } from "../lib/pagination.js";

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
		const order = await Order.findById(req.params.id).populate("products.product", "name image price");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
			return res.status(403).json({ message: "Not authorized to view this order" });
		}

		res.json(order);
	} catch (error) {
		console.log("Error in getOrderById controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getUserOrders = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query);
		const filter = { user: req.user._id };
		const [orders, total] = await Promise.all([
			Order.find(filter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate("products.product", "name image price"),
			Order.countDocuments(filter),
		]);

		res.json(paginatedResponse(orders, total, page, limit));
	} catch (error) {
		console.log("Error in getUserOrders controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getAllOrders = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query);
		const [orders, total] = await Promise.all([
			Order.find({})
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate("user", "name email")
				.populate("products.product", "name image price"),
			Order.countDocuments({}),
		]);

		res.json(paginatedResponse(orders, total, page, limit));
	} catch (error) {
		console.log("Error in getAllOrders controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];

export const updateOrderStatus = async (req, res) => {
	try {
		const { status } = req.body;

		if (!ORDER_STATUSES.includes(status)) {
			return res.status(400).json({
				message: `Invalid status. Must be one of: ${ORDER_STATUSES.join(", ")}`,
			});
		}

		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		order.status = status;
		await order.save();

		const updatedOrder = await Order.findById(order._id)
			.populate("user", "name email")
			.populate("products.product", "name image price");

		res.json(updatedOrder);
	} catch (error) {
		console.log("Error in updateOrderStatus controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
