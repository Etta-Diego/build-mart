import express from "express";
import {
	createProduct,
	deleteProduct,
	getAllProducts,
	getFeaturedProducts,
	getProductsByCategory,
	getRecommendedProducts,
	toggleFeaturedProduct,
} from "../controllers/product.controller.js";

// TODO(auth-service): the admin-gated routes below (protectRoute + adminRoute
// in the monolith) are disabled until a User/Auth Service exists that this
// service can verify JWTs against (or a gateway does it upstream). See
// docs/decision_log.md for the extraction decision and re-enablement plan.

const router = express.Router();

// router.get("/", protectRoute, adminRoute, getAllProducts);
router.get("/featured", getFeaturedProducts);
router.get("/category/:category", getProductsByCategory);
router.get("/recommendations", getRecommendedProducts);
// router.post("/", protectRoute, adminRoute, createProduct);
// router.patch("/:id", protectRoute, adminRoute, toggleFeaturedProduct);
// router.delete("/:id", protectRoute, adminRoute, deleteProduct);

export default router;
