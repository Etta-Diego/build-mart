import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		products: [
			{
				product: {
					type: mongoose.Schema.Types.ObjectId,
					ref: "Product",
					required: true,
				},
				quantity: {
					type: Number,
					required: true,
					min: 1,
				},
				price: {
					type: Number,
					required: true,
					min: 0,
				},
			},
		],
		totalAmount: {
			type: Number,
			required: true,
			min: 0,
		},
		stripeSessionId: {
			type: String,
			unique: true,
		},
		status: {
			type: String,
			enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
			default: "pending",
		},
	},
	{ timestamps: true }
);

// Mirrors backend/models/order.model.js (v1.4-monolith-baseline). The
// compound index covers getUserOrders' filter (user) + sort (createdAt)
// together; the separate createdAt-only index covers getAllOrders, which
// sorts with no user filter and so can't use the compound index's prefix.
// stripeSessionId's own index comes from its `unique: true` constraint
// above (createOrder's idempotency lookup already benefits from it) - see
// docs/decision_log.md.
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });

const Order = mongoose.model("Order", orderSchema);

export default Order;
