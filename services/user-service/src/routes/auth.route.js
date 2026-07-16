import express from "express";
import { login, logout, signup, refreshToken, getProfile, getUserCount, getUsersByIds } from "../controllers/auth.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";
import { requireInternalServiceKey } from "../middleware/internalService.middleware.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/refresh-token", refreshToken);
router.get("/profile", protectRoute, getProfile);
// Client-side analytics composition - see auth.controller.js#getUserCount.
router.get("/count", protectRoute, adminRoute, getUserCount);
// Service-to-service only (Order Service) - see auth.controller.js#getUsersByIds.
router.post("/users/batch", requireInternalServiceKey, getUsersByIds);

export default router;
