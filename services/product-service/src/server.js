import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";

import { metricsMiddleware, register, markReady } from "./lib/metrics.js";
import productRoutes from "./routes/product.route.js";
import { connectDB } from "./lib/db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(metricsMiddleware);

// Baseline Microservices has no API Gateway yet, so a browser client
// talking directly to this service is a genuine cross-origin request
// (frontend-baseline's own origin, not this service's). Restricted to
// CLIENT_URL, not a wildcard, since credentials (cookies) are involved.
// See docs/DECISION_LOG.md - this per-service CORS requirement is itself
// a citable Baseline-vs-Enhanced contrast: Enhanced's Gateway consolidates
// everything behind one origin, eliminating the need for this entirely.
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

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
