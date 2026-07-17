import Order from "../models/order.model.js";
import { getProductsByIds, ProductServiceUnavailableError } from "../lib/productServiceClient.js";
import { getUsersByIds, UserServiceUnavailableError } from "../lib/userServiceClient.js";
import { parsePagination, paginatedResponse } from "../lib/pagination.js";

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

// Resolves each order's raw `user` id to { _id, name, email } via User
// Service's batch endpoint - Order Service has no User model of its own to
// .populate() against, same cross-service constraint as
// populateOrderProducts above. Unlike that function, this one does NOT
// swallow UserServiceUnavailableError itself - it lets a total-outage
// error propagate to the caller, which decides fail-loud-vs-best-effort
// based on whether a mutation has already committed (see getAllOrders vs
// updateOrderStatus below, and docs/decision_log.md). A user id that User
// Service successfully looked up but simply didn't find (deleted/
// nonexistent account) is a different, per-record case - not an error,
// resolved here as a graceful "Unknown User" placeholder so one bad
// record doesn't blank out an otherwise-good field on its row.
async function populateOrderUsers(plainOrders) {
	const userIds = [...new Set(plainOrders.map((order) => order.user.toString()))];
	const users = await getUsersByIds(userIds);
	const userMap = new Map(users.map((user) => [user._id, user]));

	return plainOrders.map((order) => ({
		...order,
		user: userMap.get(order.user.toString()) || { _id: order.user.toString(), name: "Unknown User", email: "" },
	}));
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
		const { page, limit, skip } = parsePagination(req.query);
		const filter = { user: req.user._id };
		const [orders, total] = await Promise.all([
			Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Order.countDocuments(filter),
		]);

		const withProducts = await Promise.all(orders.map(populateOrderProducts));
		res.json(paginatedResponse(withProducts, total, page, limit));
	} catch (error) {
		console.log("Error in getUserOrders controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Admin-only, mirrors the monolith's getAllOrders (see backend/controllers/
// order.controller.js). A pure read - nothing has been mutated yet - so a
// total User Service outage fails loud (500) rather than silently
// returning a listing with every user unresolved; a per-record resolution
// gap (one deleted/nonexistent account among otherwise-healthy results)
// still degrades gracefully to "Unknown User" for just that row via
// populateOrderUsers. See docs/decision_log.md for why this differs from
// updateOrderStatus's always-best-effort approach below.
//
// Pagination happens BEFORE enrichment, not after: `total` below is a
// countDocuments({}) over the WHOLE collection (the true total order
// count), but populateOrderProducts/populateOrderUsers only ever run on
// `orders`, the already skip/limit'd page. This bounds
// populateOrderUsers' batch call to User Service by page size (at most
// `limit` distinct user ids), not by the total number of orders in the
// system - see docs/decision_log.md for why this ordering is a deliberate
// scalability property, not just implementation order.
export const getAllOrders = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query);
		const [orders, total] = await Promise.all([
			Order.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Order.countDocuments({}),
		]);

		// Product enrichment and user enrichment are independent - neither
		// reads a field the other adds (products enrichment only touches
		// `.products`, user enrichment only touches `.user`) - so running them
		// one after the other, as an earlier pass did, was purely an artifact
		// of decomposing the monolith's single .populate() call into two
		// separate cross-service helpers, not a real dependency. Run both
		// concurrently and merge by _id afterward.
		let withProducts, withUsers;
		try {
			[withProducts, withUsers] = await Promise.all([
				Promise.all(orders.map(populateOrderProducts)),
				populateOrderUsers(orders.map((order) => order.toObject())),
			]);
		} catch (error) {
			if (error instanceof UserServiceUnavailableError) {
				console.log("User Service unavailable while populating order users (failing loud):", error.message);
				return res.status(500).json({ message: "User Service is unavailable - cannot resolve order user details" });
			}
			throw error;
		}

		const userByOrderId = new Map(withUsers.map((order) => [order._id.toString(), order.user]));
		const merged = withProducts.map((order) => ({ ...order, user: userByOrderId.get(order._id.toString()) }));

		res.json(paginatedResponse(merged, total, page, limit));
	} catch (error) {
		console.log("Error in getAllOrders controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];

// Admin-only, mirrors the monolith's updateOrderStatus - same pre-save
// enum validation, confirmed necessary there (an invalid value would
// otherwise fall through to this file's generic catch block as an
// uncaught-shape 500 instead of a clean 400). Unlike getAllOrders, user
// enrichment here is ALWAYS best-effort, including on a total User Service
// outage: the status write has already committed to the database by the
// time enrichment runs for the response, so a 500 at this point would
// misleadingly suggest the update itself failed when it didn't. See
// docs/decision_log.md.
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

		// Same independence as getAllOrders above: product enrichment and user
		// enrichment don't read each other's output, so both are started here
		// (not awaited yet) to run concurrently. withProducts is still awaited
		// on its own, rather than folded into a single Promise.all, so its
		// resolved value stays available in the catch block below even if
		// usersPromise rejects - needed to preserve the existing best-effort
		// fallback, which returns the product-enriched order either way.
		const productsPromise = populateOrderProducts(order);
		const usersPromise = populateOrderUsers([order.toObject()]);
		// A promise that rejects before anything has awaited/caught it is
		// flagged by Node as an unhandled rejection, which crashes the
		// process - this can genuinely happen here, since productsPromise is
		// awaited first below and usersPromise's User-Service-down rejection
		// can land before that await completes. This no-op catch marks
		// usersPromise as handled immediately without consuming it - the real
		// try/await below still observes the same rejection normally.
		usersPromise.catch(() => {});

		const withProducts = await productsPromise;

		let populatedOrder;
		try {
			const [withUser] = await usersPromise;
			populatedOrder = { ...withProducts, user: withUser.user };
		} catch (error) {
			if (error instanceof UserServiceUnavailableError) {
				console.log(
					"User Service unavailable while populating order user for status update (write already committed; returning best-effort):",
					error.message
				);
				populatedOrder = { ...withProducts, user: { _id: withProducts.user.toString(), name: "Unknown User", email: "" } };
			} else {
				throw error;
			}
		}

		res.json(populatedOrder);
	} catch (error) {
		console.log("Error in updateOrderStatus controller", error.message);
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
		const endDate = new Date();
		const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

		// Two independent aggregate queries against the same Order collection -
		// the all-time totals pipeline doesn't read anything the 7-day daily
		// breakdown pipeline computes, or vice versa - so there's no reason to
		// run one after the other.
		const [salesData, dailySalesData] = await Promise.all([
			Order.aggregate([
				{
					$group: {
						_id: null,
						totalSales: { $sum: 1 },
						totalRevenue: { $sum: "$totalAmount" },
					},
				},
			]),
			getDailySalesData(startDate, endDate),
		]);

		const { totalSales, totalRevenue } = salesData[0] || { totalSales: 0, totalRevenue: 0 };

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
