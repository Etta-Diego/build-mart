// One-off migration script - copies non-empty cartItems from the monolith's
// `buildmart.users` collection into Redis, under the new Cart Service key
// structure (`cart:{userId}` Hash, field = productId, value = quantity), as
// part of the Stage 2 Cart Service extraction. Only well-formed items
// (those with a `product` field set - see docs/DECISION_LOG.md, "cartItems
// was storing a broken shape") are migrated; malformed legacy items are
// reported and dropped, since the new Hash-based store has no way to
// represent them anyway. Additive only - never deletes or modifies
// anything in `buildmart`. Not wired into the app.
//   node scripts/migrate-carts.js

import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Redis from "ioredis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Same opt-in DNS workaround as backend/lib/db.js - this script connects
// directly rather than importing that module, so it needs its own copy.
if (process.env.DNS_WORKAROUND === "true") {
	dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

const SOURCE_URI = process.env.MONGO_URI;
if (!SOURCE_URI) {
	console.error("MONGO_URI not found in .env - aborting.");
	process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const run = async () => {
	const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
	const redis = new Redis(REDIS_URL);
	console.log("Connected to source (buildmart) and Redis.");

	const users = await sourceConn.collection("users").find({ "cartItems.0": { $exists: true } }).toArray();
	console.log(`Users with a non-empty cartItems array: ${users.length}`);

	let validItemsMigrated = 0;
	let malformedItemsDropped = 0;
	let usersMigrated = 0;

	for (const user of users) {
		const key = `cart:${user._id.toString()}`;
		const validItems = user.cartItems.filter((item) => item.product);
		const malformedCount = user.cartItems.length - validItems.length;

		if (malformedCount > 0) {
			console.log(`  User ${user._id} (${user.email}): ${malformedCount} malformed item(s) dropped.`);
			malformedItemsDropped += malformedCount;
		}

		if (validItems.length === 0) {
			continue;
		}

		// HSET with multiple field/value pairs in one call. If the same
		// product appears more than once in the legacy array (shouldn't
		// happen, but not guaranteed by the old schema), the last one wins -
		// same effective behavior as the last write in a sequential HSET loop.
		const fieldValues = [];
		for (const item of validItems) {
			fieldValues.push(item.product.toString(), item.quantity);
		}
		await redis.hset(key, ...fieldValues);

		validItemsMigrated += validItems.length;
		usersMigrated += 1;
	}

	console.log(`Users migrated (had at least one valid item): ${usersMigrated}`);
	console.log(`Valid items migrated: ${validItemsMigrated}`);
	console.log(`Malformed items dropped: ${malformedItemsDropped}`);
	console.log(`Source (buildmart.users) untouched.`);

	await sourceConn.close();
	await redis.quit();
};

run().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
