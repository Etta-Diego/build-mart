import express from "express";
import { getAllOrders, getOrderById, getUserOrders, updateOrderStatus } from "../controllers/order.controller.js";
import { adminRoute, protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protectRoute, getUserOrders);
router.get("/all", protectRoute, adminRoute, getAllOrders);
router.get("/:id", protectRoute, getOrderById);
router.patch("/:id/status", protectRoute, adminRoute, updateOrderStatus);

export default router;
