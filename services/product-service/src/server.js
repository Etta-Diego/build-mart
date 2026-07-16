import express from "express";
import dotenv from "dotenv";

import { metricsMiddleware, register, markReady } from "./lib/metrics.js";
import productRoutes from "./routes/product.route.js";
import { connectDB } from "./lib/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(metricsMiddleware);

app.use(express.json({ limit: "10mb" }));

app.get("/metrics", async (req, res) => {
	res.set("Content-Type", register.contentType);
	res.end(await register.metrics());
});

app.use("/api/products", productRoutes);

const startServer = async () => {
	await connectDB();
	app.listen(PORT, () => {
		console.log("Product service is running on http://localhost:" + PORT);
		markReady();
	});
};

startServer();
