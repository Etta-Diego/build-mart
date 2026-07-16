import express from "express";
import {
	createProduct,
	deleteProduct,
	getAllProducts,
	getFeaturedProducts,
	getProductsByBatch,
	getProductsByCategory,
	getRecommendedProducts,
	toggleFeaturedProduct,
} from "../controllers/product.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";

// The admin-gated routes below were disabled when this service was first
// extracted, since no User/Auth Service existed yet to verify JWTs against
// (see docs/decision_log.md). Now that services/user-service/ exists and
// issues JWTs this service can verify locally (stateless, shared
// ACCESS_TOKEN_SECRET - see ./middleware/auth.middleware.js), they're
// re-enabled here.

const router = express.Router();

router.get("/", protectRoute, adminRoute, getAllProducts);
router.get("/featured", getFeaturedProducts);
router.get("/category/:category", getProductsByCategory);
router.get("/recommendations", getRecommendedProducts);
// Public, same trust level as the other read-only product routes above -
// used by Cart Service (and any future service) to resolve full product
// details for a set of IDs in one round trip instead of N individual calls.
router.post("/batch", getProductsByBatch);
router.post("/", protectRoute, adminRoute, createProduct);
router.patch("/:id", protectRoute, adminRoute, toggleFeaturedProduct);
router.delete("/:id", protectRoute, adminRoute, deleteProduct);

export default router;
