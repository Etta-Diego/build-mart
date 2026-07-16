import dotenv from "dotenv";

dotenv.config();

const REQUEST_TIMEOUT_MS = 5000;

// Thrown whenever Product Service can't be reached or doesn't respond
// successfully. Used only by order.controller.js's read endpoints
// (getOrderById/getUserOrders) to resolve display-only product
// name/image alongside the order's own immutable price/quantity
// snapshot - NOT used by payment.controller.js, which never calls
// Product Service (see docs/decision_log.md). Discovered mid-extraction:
// order.model.js's `ref: "Product"` can no longer be resolved via
// Mongoose's .populate() now that Product lives in a separate service
// with its own Mongoose connection - .populate() requires the referenced
// model to be registered in the same connection, which is no longer
// true once Product Service is a separate process/database.
export class ProductServiceUnavailableError extends Error {}

export async function getProductsByIds(ids) {
	const baseUrl = process.env.PRODUCT_SERVICE_URL || "http://localhost:5001";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	let response;
	try {
		response = await fetch(`${baseUrl}/api/products/batch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids }),
			signal: controller.signal,
		});
	} catch (error) {
		throw new ProductServiceUnavailableError(`Could not reach Product Service: ${error.message}`);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		throw new ProductServiceUnavailableError(`Product Service responded with HTTP ${response.status}`);
	}

	return response.json();
}
