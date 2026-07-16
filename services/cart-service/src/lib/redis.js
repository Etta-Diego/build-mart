import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
	maxRetriesPerRequest: 3,
	connectTimeout: 5000,
	retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on("error", (err) => {
	console.log("Redis connection error:", err.message);
});
