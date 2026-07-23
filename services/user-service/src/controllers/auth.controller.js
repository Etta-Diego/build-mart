import { redis } from "../lib/redis.js";
import User from "../models/user.model.js";
import jwt from "jsonwebtoken";

// Signs { userId, role } into BOTH tokens (not just the access token), so
// that refreshToken below can re-issue a fresh access token with the
// current role using only the refresh token's own payload - no database
// lookup needed, consistent with this service's stateless-verification
// design (see auth.middleware.js). Tradeoff: if a user's role changes
// mid-session, the change won't be reflected in their tokens until they
// log in again or their refresh token itself expires (7 days) - there is
// no shorter propagation path in the baseline stage. See
// docs/decision_log.md.
const generateTokens = (userId, role) => {
	const accessToken = jwt.sign({ userId, role }, process.env.ACCESS_TOKEN_SECRET, {
		expiresIn: "15m",
	});

	const refreshToken = jwt.sign({ userId, role }, process.env.REFRESH_TOKEN_SECRET, {
		expiresIn: "7d",
	});

	return { accessToken, refreshToken };
};

const storeRefreshToken = async (userId, refreshToken) => {
	await redis.set(`refresh_token:${userId}`, refreshToken, "EX", 7 * 24 * 60 * 60); // 7days
};

export const signup = async (req, res) => {
	const { email, password, name } = req.body;
	try {
		const userExists = await User.findOne({ email });

		if (userExists) {
			return res.status(400).json({ message: "User already exists" });
		}
		const user = await User.create({ name, email, password });

		// authenticate
		const { accessToken, refreshToken } = generateTokens(user._id, user.role);
		await storeRefreshToken(user._id, refreshToken);

		res.status(201).json({
			_id: user._id,
			name: user.name,
			email: user.email,
			role: user.role,
			accessToken,
			refreshToken,
		});
	} catch (error) {
		console.log("Error in signup controller", error.message);
		res.status(500).json({ message: error.message });
	}
};

export const login = async (req, res) => {
	try {
		const { email, password } = req.body;
		const user = await User.findOne({ email });

		if (user && (await user.comparePassword(password))) {
			const { accessToken, refreshToken } = generateTokens(user._id, user.role);
			await storeRefreshToken(user._id, refreshToken);

			res.json({
				_id: user._id,
				name: user.name,
				email: user.email,
				role: user.role,
				accessToken,
				refreshToken,
			});
		} else {
			res.status(400).json({ message: "Invalid email or password" });
		}
	} catch (error) {
		console.log("Error in login controller", error.message);
		res.status(500).json({ message: error.message });
	}
};

export const logout = async (req, res) => {
	try {
		const refreshToken = req.body.refreshToken;
		if (refreshToken) {
			const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
			await redis.del(`refresh_token:${decoded.userId}`);
		}

		res.json({ message: "Logged out successfully" });
	} catch (error) {
		console.log("Error in logout controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// this will refresh the access token
export const refreshToken = async (req, res) => {
	try {
		const refreshToken = req.body.refreshToken;

		if (!refreshToken) {
			return res.status(401).json({ message: "No refresh token provided" });
		}

		const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
		const storedToken = await redis.get(`refresh_token:${decoded.userId}`);

		if (storedToken !== refreshToken) {
			return res.status(401).json({ message: "Invalid refresh token" });
		}

		const accessToken = jwt.sign({ userId: decoded.userId, role: decoded.role }, process.env.ACCESS_TOKEN_SECRET, {
			expiresIn: "15m",
		});

		res.json({ message: "Token refreshed successfully", accessToken, refreshToken });
	} catch (error) {
		console.log("Error in refreshToken controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getProfile = async (req, res) => {
	try {
		// protectRoute is stateless (see auth.middleware.js) and only sets
		// req.user = { _id, role } from the verified token - it never queries
		// the database. This route is the one place that still needs the full
		// profile, so it fetches it here directly (this service's own
		// database, not a cross-service call), rather than making the
		// middleware do a DB lookup for every route just to serve this one.
		const user = await User.findById(req.user._id).select("-password");
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}
		res.json(user);
	} catch (error) {
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// New in User Service - not present in the monolith. The monolith's
// admin analytics dashboard read this figure via a direct
// User.countDocuments() call inside analytics.controller.js, which had no
// service boundary to cross. In Baseline Microservices there is no
// Analytics service (per CLAUDE.md, analytics is a composition layer, not
// a domain service) and no Gateway yet to host that composition - so each
// service that owns a piece of the dashboard exposes a small summary of
// its own data (this is normal service behavior, not analytics logic
// living here), and the frontend composes the pieces client-side. See
// docs/decision_log.md.
export const getUserCount = async (req, res) => {
	try {
		const count = await User.countDocuments();
		res.json({ count });
	} catch (error) {
		console.log("Error in getUserCount controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Service-to-service only (Order Service's admin Order Overview, to
// resolve name/email for the admin listing - Order Service only stores a
// raw user id, and .populate() can't cross a service/database boundary).
// Gated by requireInternalServiceKey, not protectRoute - the caller is
// another service, not an end user with their own token. Missing ids for
// deleted/nonexistent users are simply absent from the response array,
// not an error - the caller (Order Service) treats that as a per-record
// resolution gap, not a service failure. See
// ../middleware/internalService.middleware.js and docs/decision_log.md.
export const getUsersByIds = async (req, res) => {
	try {
		const { ids } = req.body;

		if (!Array.isArray(ids) || ids.length === 0) {
			return res.json([]);
		}

		const users = await User.find({ _id: { $in: ids } }).select("name email");
		res.json(users);
	} catch (error) {
		console.log("Error in getUsersByIds controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
