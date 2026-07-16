// Minimal service-to-service trust gate for Baseline Microservices.
//
// This is NOT auth.middleware.js's ACCESS_TOKEN_SECRET / end-user JWT
// verification. INTERNAL_SERVICE_KEY is a separate, service-to-service
// shared secret with no relationship to user identity, role, or session -
// conceptually distinct from user authentication, not a variant of it.
// It exists only to keep this specific write endpoint (POST /deactivate)
// from being callable by arbitrary public requests, not to establish real
// service identity or fine-grained authorization between services.
//
// This is Baseline's deliberately minimal, ad hoc answer to "how does one
// service trust a call from another service" - unlike Product Service's
// batch endpoint (a public read, no gate needed), this endpoint performs a
// write, so it gets this lightweight check instead of staying public.
// Enhanced's API Gateway is expected to formalize inter-service trust
// centrally (so individual services stop inventing their own conventions
// for this), rather than every write endpoint growing its own ad hoc
// shared-secret check. See docs/decision_log.md.
export const requireInternalServiceKey = (req, res, next) => {
	const providedKey = req.headers["x-internal-service-key"];

	if (!providedKey || providedKey !== process.env.INTERNAL_SERVICE_KEY) {
		return res.status(401).json({ message: "Unauthorized - missing or invalid internal service key" });
	}

	next();
};
