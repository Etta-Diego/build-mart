import jwt from "jsonwebtoken";

// Stateless JWT verification - a Baseline Microservices design decision.
//
// This file is DUPLICATED (not imported cross-service) into every service
// that needs auth, including User/Auth Service itself. Every copy verifies
// the access token's signature locally against the shared
// ACCESS_TOKEN_SECRET and trusts the { userId, role } claims embedded in
// the token directly - no database lookup, no HTTP call back to
// User/Auth Service, not even from User/Auth Service's own copy.
//
// Tradeoff: a role change (or account change) only takes effect on the
// user's next login, or their next access-token refresh (up to 15 minutes
// later, since role is also signed into the refresh token - see
// generateTokens in user-service's auth.controller.js) - never instantly.
// In exchange, every service can authenticate a request in-process, with
// no dependency on User/Auth Service being up or fast. Centralized,
// always-fresh authorization is deferred to the API Gateway in the
// Enhanced Microservices stage. See docs/decision_log.md for the full
// rationale.
export const protectRoute = (req, res, next) => {
	try {
		const accessToken = req.cookies.accessToken;

		if (!accessToken) {
			return res.status(401).json({ message: "Unauthorized - No access token provided" });
		}

		try {
			const decoded = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);
			req.user = { _id: decoded.userId, role: decoded.role };
			next();
		} catch (error) {
			if (error.name === "TokenExpiredError") {
				return res.status(401).json({ message: "Unauthorized - Access token expired" });
			}
			throw error;
		}
	} catch (error) {
		console.log("Error in protectRoute middleware", error.message);
		return res.status(401).json({ message: "Unauthorized - Invalid access token" });
	}
};

export const adminRoute = (req, res, next) => {
	if (req.user && req.user.role === "admin") {
		next();
	} else {
		return res.status(403).json({ message: "Access denied - Admin only" });
	}
};
