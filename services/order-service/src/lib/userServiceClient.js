import dotenv from "dotenv";

dotenv.config();

const REQUEST_TIMEOUT_MS = 5000;

// Thrown only when User Service itself can't be reached or doesn't
// respond successfully (network error, timeout, non-2xx) - a total
// dependency outage. Distinct from a specific user id simply not being in
// the response array (a deleted/nonexistent user), which is a normal,
// successful outcome, not this error. getAllOrders treats this error as
// total-outage (fails loud, 500) vs. per-record resolution gaps (graceful
// "Unknown User" degradation) - see order.controller.js and
// docs/decision_log.md for the full read-vs-write rationale.
export class UserServiceUnavailableError extends Error {}

export async function getUsersByIds(ids) {
	if (!ids || ids.length === 0) {
		return [];
	}

	const baseUrl = process.env.USER_SERVICE_URL || "http://localhost:5002";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response;
	try {
		response = await fetch(`${baseUrl}/api/auth/users/batch`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Service-Key": process.env.INTERNAL_SERVICE_KEY,
			},
			body: JSON.stringify({ ids }),
			signal: controller.signal,
		});
	} catch (error) {
		throw new UserServiceUnavailableError(`Could not reach User Service: ${error.message}`);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		throw new UserServiceUnavailableError(`User Service responded with HTTP ${response.status}`);
	}

	return response.json();
}
