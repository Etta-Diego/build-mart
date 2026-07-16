import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { requireInternalServiceKey } from "../middleware/internalService.middleware.js";
import { deactivateCoupon, getCoupon, validateCoupon } from "../controllers/coupon.controller.js";

const router = express.Router();

router.get("/", protectRoute, getCoupon);
router.post("/validate", protectRoute, validateCoupon);
// Service-to-service only (Order Service, once extracted) - not an
// end-user route, so it's gated by requireInternalServiceKey instead of
// protectRoute. See ../middleware/internalService.middleware.js.
router.patch("/deactivate", requireInternalServiceKey, deactivateCoupon);

export default router;
