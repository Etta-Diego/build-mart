import dotenv from "dotenv";

dotenv.config();

const REQUEST_TIMEOUT_MS = 5000;

// Thrown whenever Product Service can't be reached or doesn't respond
// successfully - the controller catches this specifically and turns it into
// a deliberate 503, rather than letting a network error surface as an
// unhandled rejection or a generic 500. See docs/decision_log.md: this is
// Baseline's documented, intentional failure mode under a dependency
// outage, not an oversight.
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
