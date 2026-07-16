import dotenv from "dotenv";

dotenv.config();

const REQUEST_TIMEOUT_MS = 5000;

// Thrown whenever Coupon Service can't be reached or doesn't respond
// successfully (excluding a 404 from validateCoupon, which is a
// legitimate "no valid coupon" outcome, not a service failure - see
// below). Same fail-fast-vs-best-effort split as
// CartServiceUnavailableError; see docs/decision_log.md.
export class CouponServiceUnavailableError extends Error {}

function couponServiceBaseUrl() {
	return process.env.COUPON_SERVICE_URL || "http://localhost:5004";
}

async function fetchWithTimeout(url, options) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		throw new CouponServiceUnavailableError(`Could not reach Coupon Service: ${error.message}`);
	} finally {
		clearTimeout(timeout);
	}
}

// Token-forwarded - mirrors the caller's own live session, same as
// Cart Service's clearCart. Returns null on a 404 (no valid coupon for
// this code/user - the same outcome the monolith's inline
// Coupon.findOne would produce as `coupon = null`), only throws
// CouponServiceUnavailableError on unreachable/non-2xx-non-404.
export async function validateCoupon(accessToken, code) {
	const response = await fetchWithTimeout(`${couponServiceBaseUrl()}/api/coupons/validate`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: `accessToken=${accessToken}` },
		body: JSON.stringify({ code }),
	});

	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new CouponServiceUnavailableError(`Coupon Service responded with HTTP ${response.status}`);
	}
	return response.json();
}

// Token-forwarded - creates a reward coupon FOR the caller's own session
// user. Coupon Service derives userId from the token itself
// (req.user._id), not from anything in this call's body.
export async function createCoupon(accessToken) {
	const response = await fetchWithTimeout(`${couponServiceBaseUrl()}/api/coupons`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: `accessToken=${accessToken}` },
	});

	if (!response.ok) {
		throw new CouponServiceUnavailableError(`Coupon Service responded with HTTP ${response.status}`);
	}
	return response.json();
}

// Shared-secret gated (not token-forwarded) - a system-triggered side
// effect of a confirmed Stripe payment, not a user action taken through
// their own session. See
// services/coupon-service/src/middleware/internalService.middleware.js.
export async function deactivateCoupon(code, userId) {
	const response = await fetchWithTimeout(`${couponServiceBaseUrl()}/api/coupons/deactivate`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			"X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY,
		},
		body: JSON.stringify({ code, userId }),
	});

	if (!response.ok) {
		throw new CouponServiceUnavailableError(`Coupon Service responded with HTTP ${response.status}`);
	}
	return response.json();
}
