import express from "express";
import { getOrderById, getUserOrders } from "../controllers/order.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", protectRoute, getUserOrders);
router.get("/:id", protectRoute, getOrderById);

export default router;
