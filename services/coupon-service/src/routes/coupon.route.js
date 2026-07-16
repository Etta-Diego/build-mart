import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { requireInternalServiceKey } from "../middleware/internalService.middleware.js";
import { createCoupon, deactivateCoupon, getCoupon, validateCoupon } from "../controllers/coupon.controller.js";

const router = express.Router();

router.get("/", protectRoute, getCoupon);
router.post("/validate", protectRoute, validateCoupon);
// Token-forwarded (protectRoute) - userId comes from req.user._id, not the
// body. Called by Order Service's createCheckoutSession when totalAmount
// qualifies for a reward coupon. See coupon.controller.js#createCoupon.
router.post("/", protectRoute, createCoupon);
// Service-to-service only (Order Service, once extracted) - not an
// end-user route, so it's gated by requireInternalServiceKey instead of
// protectRoute. See ../middleware/internalService.middleware.js.
router.patch("/deactivate", requireInternalServiceKey, deactivateCoupon);

export default router;
