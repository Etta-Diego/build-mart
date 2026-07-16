import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import { metricsMiddleware, register, markReady } from "./lib/metrics.js";
import orderRoutes from "./routes/order.route.js";
import paymentRoutes from "./routes/payment.route.js";
import { connectDB } from "./lib/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5005;

app.use(metricsMiddleware);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/metrics", async (req, res) => {
	res.set("Content-Type", register.contentType);
	res.end(await register.metrics());
});

app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);

const startServer = async () => {
	await connectDB();
	app.listen(PORT, () => {
		console.log("Order service is running on http://localhost:" + PORT);
		markReady();
	});
};

startServer();
