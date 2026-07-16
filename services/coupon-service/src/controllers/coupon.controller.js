import Coupon from "../models/coupon.model.js";

export const getCoupon = async (req, res) => {
	try {
		const coupon = await Coupon.findOne({ userId: req.user._id, isActive: true });
		res.json(coupon || null);
	} catch (error) {
		console.log("Error in getCoupon controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const validateCoupon = async (req, res) => {
	try {
		const { code } = req.body;
		const coupon = await Coupon.findOne({ code: code, userId: req.user._id, isActive: true });

		if (!coupon) {
			return res.status(404).json({ message: "Coupon not found" });
		}

		if (coupon.expirationDate < new Date()) {
			coupon.isActive = false;
			await coupon.save();
			return res.status(404).json({ message: "Coupon expired" });
		}

		res.json({
			message: "Coupon is valid",
			code: coupon.code,
			discountPercentage: coupon.discountPercentage,
		});
	} catch (error) {
		console.log("Error in validateCoupon controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// New in Coupon Service - not present in the monolith. Ports
// payment.controller.js#createNewCoupon's exact logic (grant a 10%,
// 30-day "GIFT" coupon, unconditionally replacing any existing coupon for
// the user - same as the original, which never checked whether the
// existing coupon was still active/unused before deleting it) verbatim,
// moved here since it's coupon-domain write logic, not order-domain
// logic. userId comes from req.user._id (the forwarded token), not the
// request body - unlike deactivateCoupon below, this route is
// protectRoute-gated (token-forwarded), not shared-secret, since it's
// triggered by a live user's own checkout, not a system-only side
// effect with no user session available. Order Service decides WHEN to
// call this (the >=$200 threshold is order-domain business logic);
// Coupon Service owns WHAT the reward looks like.
export const createCoupon = async (req, res) => {
	try {
		const userId = req.user._id;

		await Coupon.findOneAndDelete({ userId });

		const newCoupon = new Coupon({
			code: "GIFT" + Math.random().toString(36).substring(2, 8).toUpperCase(),
			discountPercentage: 10,
			expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
			userId,
		});

		await newCoupon.save();

		res.status(201).json(newCoupon);
	} catch (error) {
		console.log("Error in createCoupon controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Mirrors the exact findOneAndUpdate query payment.controller.js#checkoutSuccess currently
// runs directly against the Coupon model ({ code, userId } -> isActive:
// false), so this is a drop-in replacement for that call once Order
// Service exists and can call INTO Coupon Service instead of touching its
// database directly. Deliberately tolerant of "no matching coupon" (never
// treated as an error) - the original inline call never checked its
// result either, since a missing/already-deactivated coupon is a normal,
// expected outcome (e.g. a checkout with no coupon applied, or a retried
// checkout-success call), not a failure. Gated by requireInternalServiceKey
// (see ../middleware/internalService.middleware.js), not protectRoute -
// this is a service-to-service call, not an end-user request.
export const deactivateCoupon = async (req, res) => {
	try {
		const { code, userId } = req.body;

		if (!code || !userId) {
			return res.status(400).json({ message: "code and userId are required" });
		}

		const coupon = await Coupon.findOneAndUpdate({ code, userId }, { isActive: false }, { new: true });

		res.json({ deactivated: !!coupon, coupon: coupon || null });
	} catch (error) {
		console.log("Error in deactivateCoupon controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
