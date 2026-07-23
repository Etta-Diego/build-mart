import dotenv from "dotenv";

dotenv.config();

const REQUEST_TIMEOUT_MS = 5000;

// Thrown whenever Cart Service can't be reached or doesn't respond
// successfully. See docs/decision_log.md for how callers are expected to
// react: fail-fast (before the Stripe session exists) in
// createCheckoutSession, best-effort/log-and-continue (after payment has
// already been confirmed) in checkoutSuccess - the same client, two
// different, deliberately different response strategies depending on
// where in the flow the call happens.
export class CartServiceUnavailableError extends Error {}

// Token-forwarded - Cart Service's own auth.middleware.js expects a real
// end-user access token as an Authorization: Bearer header, same as if
// the user had called it directly. Clears the user's entire cart (no
// productId), replacing the monolith's
// User.findByIdAndUpdate(userId, { cartItems: [] }).
export async function clearCart(accessToken) {
	const baseUrl = process.env.CART_SERVICE_URL || "http://localhost:5003";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response;
	try {
		response = await fetch(`${baseUrl}/api/cart`, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({}),
			signal: controller.signal,
		});
	} catch (error) {
		throw new CartServiceUnavailableError(`Could not reach Cart Service: ${error.message}`);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		throw new CartServiceUnavailableError(`Cart Service responded with HTTP ${response.status}`);
	}

	return response.json();
}
