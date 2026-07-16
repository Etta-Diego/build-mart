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

// New in Order Service - not present in the monolith as a standalone
// endpoint. Ports the sales/revenue portion of the monolith's
// analytics.controller.js#getAnalyticsData (minus users/products, which
// now live in User Service and Product Service respectively) and
// #getDailySalesData verbatim, since Order Service already owns all the
// data needed for both - no cross-service call required. See
// user-service's auth.controller.js#getUserCount for the full rationale
// on why this exists per-service instead of as a dedicated Analytics
// service. See docs/decision_log.md.
export const getOrderSummary = async (req, res) => {
	try {
		const salesData = await Order.aggregate([
			{
				$group: {
					_id: null,
					totalSales: { $sum: 1 },
					totalRevenue: { $sum: "$totalAmount" },
				},
			},
		]);

		const { totalSales, totalRevenue } = salesData[0] || { totalSales: 0, totalRevenue: 0 };

		const endDate = new Date();
		const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
		const dailySalesData = await getDailySalesData(startDate, endDate);

		res.json({ totalSales, totalRevenue, dailySalesData });
	} catch (error) {
		console.log("Error in getOrderSummary controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

async function getDailySalesData(startDate, endDate) {
	const dailySalesData = await Order.aggregate([
		{
			$match: {
				createdAt: {
					$gte: startDate,
					$lte: endDate,
				},
			},
		},
		{
			$group: {
				_id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
				sales: { $sum: 1 },
				revenue: { $sum: "$totalAmount" },
			},
		},
		{ $sort: { _id: 1 } },
	]);

	const dateArray = getDatesInRange(startDate, endDate);

	return dateArray.map((date) => {
		const foundData = dailySalesData.find((item) => item._id === date);

		return {
			date,
			sales: foundData?.sales || 0,
			revenue: foundData?.revenue || 0,
		};
	});
}

function getDatesInRange(startDate, endDate) {
	const dates = [];
	let currentDate = new Date(startDate);

	while (currentDate <= endDate) {
		dates.push(currentDate.toISOString().split("T")[0]);
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dates;
}
