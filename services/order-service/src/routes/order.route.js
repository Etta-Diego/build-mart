import express from "express";
import { getOrderById, getOrderSummary, getUserOrders } from "../controllers/order.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protectRoute, getUserOrders);
// Must be registered BEFORE GET /:id, or Express would match "summary" as
// an order id. Client-side analytics composition - see
// order.controller.js#getOrderSummary.
router.get("/summary", protectRoute, adminRoute, getOrderSummary);
router.get("/:id", protectRoute, getOrderById);

export default router;
