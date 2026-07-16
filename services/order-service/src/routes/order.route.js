import express from "express";
import { getAllOrders, getOrderById, getOrderSummary, getUserOrders, updateOrderStatus } from "../controllers/order.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protectRoute, getUserOrders);
// "/all" and "/summary" must both be registered BEFORE GET /:id, or
// Express would match either literal segment as an order id. Mirrors the
// monolith's admin Order Overview listing - see
// order.controller.js#getAllOrders.
router.get("/all", protectRoute, adminRoute, getAllOrders);
// Client-side analytics composition - see order.controller.js#getOrderSummary.
router.get("/summary", protectRoute, adminRoute, getOrderSummary);
router.get("/:id", protectRoute, getOrderById);
router.patch("/:id/status", protectRoute, adminRoute, updateOrderStatus);

export default router;
