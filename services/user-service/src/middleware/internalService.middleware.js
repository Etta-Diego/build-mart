// Minimal service-to-service trust gate for Baseline Microservices.
//
// This is NOT auth.middleware.js's ACCESS_TOKEN_SECRET / end-user JWT
// verification. INTERNAL_SERVICE_KEY is a separate, service-to-service
// shared secret with no relationship to user identity, role, or session -
// conceptually distinct from user authentication, not a variant of it.
// It exists only to keep this specific read endpoint (POST /users/batch)
// from being callable by arbitrary public requests, not to establish real
// service identity or fine-grained authorization between services.
//
// Unlike Product Service's batch endpoint (a public read, no gate needed -
// product catalog data isn't sensitive), this endpoint returns user
// name/email - PII - so it gets the same shared-secret gate as Coupon
// Service's write endpoint, even though this one is a read. The gating
// decision here tracks data sensitivity, not read-vs-write. See
// docs/decision_log.md.
export const requireInternalServiceKey = (req, res, next) => {
	const providedKey = req.headers["x-internal-service-key"];

	if (!providedKey || providedKey !== process.env.INTERNAL_SERVICE_KEY) {
		return res.status(401).json({ message: "Unauthorized - missing or invalid internal service key" });
	}

	next();
};
