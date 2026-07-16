import { stripe } from "../lib/stripe.js";
import { createOrder } from "./order.controller.js";
import { clearCart } from "../lib/cartServiceClient.js";
import { validateCoupon, createCoupon, deactivateCoupon, CouponServiceUnavailableError } from "../lib/couponServiceClient.js";

// Deliberately preserved from the monolith: line items (name/image/price)
// and totalAmount come straight from the client-submitted `products`
// array, not from a server-side Cart Service "get cart" call or a
// Product Service price lookup. This is a real, pre-existing trust gap
// (a client could submit an arbitrary price) - it is NOT fixed here, in
// either Baseline or Enhanced, because closing it would be a behavioral
// change to the highest-risk code path in this project, not a pure
// extraction. Documented in docs/decision_log.md as a deliberate
// limitation for the dissertation's Limitations/Future Work section.
export const createCheckoutSession = async (req, res) => {
	try {
		const { products, couponCode } = req.body;

		if (!Array.isArray(products) || products.length === 0) {
			return res.status(400).json({ error: "Invalid or empty products array" });
		}

		const accessToken = req.cookies.accessToken;

		let totalAmount = 0;

		const lineItems = products.map((product) => {
			const amount = Math.round(product.price * 100); // stripe wants u to send in the format of cents
			totalAmount += amount * product.quantity;

			return {
				price_data: {
					currency: "usd",
					product_data: {
						name: product.name,
						images: [product.image],
					},
					unit_amount: amount,
				},
				quantity: product.quantity || 1,
			};
		});

		// All calls to other services happen BEFORE the Stripe session is
		// created (reordered from the monolith, where the >=$200 reward-coupon
		// check ran AFTER stripe.checkout.sessions.create() even though
		// totalAmount was already fully known beforehand - nothing required
		// that order). This way, a dependency outage always fails before any
		// Stripe side effect exists, instead of risking an orphaned,
		// never-returned-to-the-client Stripe session. See
		// docs/decision_log.md - fail-fast applies here because nothing
		// costly/irreversible (the Stripe charge) has happened yet.
		let stripeCouponId = null;

		if (couponCode) {
			let validated;
			try {
				validated = await validateCoupon(accessToken, couponCode);
			} catch (error) {
				if (error instanceof CouponServiceUnavailableError) {
					console.log("Coupon Service unavailable during createCheckoutSession:", error.message);
					return res.status(503).json({
						message: "Coupon Service is unavailable - checkout could not be created. Try again shortly.",
					});
				}
				throw error;
			}

			if (validated) {
				totalAmount -= Math.round((totalAmount * validated.discountPercentage) / 100);
				stripeCouponId = await createStripeCoupon(validated.discountPercentage);
			}
		}

		if (totalAmount >= 20000) {
			try {
				await createCoupon(accessToken);
			} catch (error) {
				if (error instanceof CouponServiceUnavailableError) {
					console.log("Coupon Service unavailable while creating reward coupon:", error.message);
					return res.status(503).json({
						message: "Coupon Service is unavailable - checkout could not be created. Try again shortly.",
					});
				}
				throw error;
			}
		}

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],
			line_items: lineItems,
			mode: "payment",
			success_url: `${process.env.CLIENT_URL}/purchase-success?session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${process.env.CLIENT_URL}/purchase-cancel`,
			discounts: stripeCouponId ? [{ coupon: stripeCouponId }] : [],
			metadata: {
				userId: req.user._id.toString(),
				couponCode: couponCode || "",
				products: JSON.stringify(
					products.map((p) => ({
						id: p._id,
						quantity: p.quantity,
						price: p.price,
					}))
				),
			},
		});

		res.status(200).json({ id: session.id, totalAmount: totalAmount / 100 });
	} catch (error) {
		console.error("Error processing checkout:", error);
		res.status(500).json({ message: "Error processing checkout", error: error.message });
	}
};

export const checkoutSuccess = async (req, res) => {
	try {
		const { sessionId } = req.body;
		const session = await stripe.checkout.sessions.retrieve(sessionId);

		if (session.payment_status === "paid") {
			// Stripe has ALREADY confirmed payment by this point - the money has
			// moved and cannot be undone by anything this handler does. General
			// principle (see docs/decision_log.md): fail-fast applies BEFORE the
			// costly/irreversible action (the Stripe charge, in
			// createCheckoutSession above); best-effort-with-logging applies
			// AFTER it, here, because failing this response would tell a
			// genuinely paying customer their payment didn't go through and
			// would silently drop the Order record - a materially worse outcome
			// than a coupon staying active a bit longer or a cart not
			// auto-clearing. createOrder is done FIRST specifically because it
			// has no external service dependency at all (it only reads
			// session.metadata - the price/product snapshot captured at
			// checkout-creation time, never re-fetched from Product Service) and
			// is the one step that must never be lost.
			const newOrder = await createOrder(session);

			const accessToken = req.cookies.accessToken;

			if (session.metadata.couponCode) {
				try {
					await deactivateCoupon(session.metadata.couponCode, session.metadata.userId);
				} catch (error) {
					console.log(
						"Best-effort coupon deactivation failed after payment succeeded (order still created):",
						error.message
					);
				}
			}

			try {
				await clearCart(accessToken);
			} catch (error) {
				console.log("Best-effort cart clear failed after payment succeeded (order still created):", error.message);
			}

			res.status(200).json({
				success: true,
				message: "Payment successful, order created, and coupon deactivated if used.",
				orderId: newOrder._id,
			});
		} else {
			res.status(400).json({ success: false, message: "Payment not completed." });
		}
	} catch (error) {
		console.error("Error processing successful checkout:", error);
		res.status(500).json({ message: "Error processing successful checkout", error: error.message });
	}
};

async function createStripeCoupon(discountPercentage) {
	const coupon = await stripe.coupons.create({
		percent_off: discountPercentage,
		duration: "once",
	});

	return coupon.id;
}
