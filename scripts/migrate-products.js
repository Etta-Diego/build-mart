// One-off migration script - copies all documents from the monolith's
// `buildmart` database `products` collection into the new, separate
// `product-service-db` database (same Atlas cluster), as part of the Stage 2
// Product Service extraction. Idempotent (skips documents whose _id already
// exists in the target) and additive only - never deletes or modifies
// anything in the source `buildmart` database. Not wired into the app.
//   node scripts/migrate-products.js

import path from "path";
import { fileURLToPath } from "url";
import dns from "dns";
import dotenv from "dotenv";
import mongoose from "mongoose";

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

// Swap only the database name segment (.../buildmart? -> .../product-service-db?)
// so both connections point at the same Atlas cluster.
const TARGET_URI = SOURCE_URI.replace(/\/buildmart(\?|$)/, "/product-service-db$1");
if (TARGET_URI === SOURCE_URI) {
	console.error("Could not derive target URI - expected '/buildmart' in MONGO_URI. Aborting.");
	process.exit(1);
}

const run = async () => {
	const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
	const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();
	console.log("Connected to source (buildmart) and target (product-service-db).");

	const sourceProducts = sourceConn.collection("products");
	const targetProducts = targetConn.collection("products");

	const sourceDocs = await sourceProducts.find({}).toArray();
	const sourceCount = sourceDocs.length;
	console.log(`Source products collection: ${sourceCount} documents.`);

	const existingIds = new Set((await targetProducts.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id.toString()));

	const toInsert = sourceDocs.filter((doc) => !existingIds.has(doc._id.toString()));
	const skipped = sourceCount - toInsert.length;

	if (toInsert.length > 0) {
		await targetProducts.insertMany(toInsert);
	}

	const targetCount = await targetProducts.countDocuments();

	console.log(`Inserted: ${toInsert.length}, skipped (already present): ${skipped}`);
	console.log(`Target products collection now has: ${targetCount} documents.`);
	console.log(`Source (buildmart.products) untouched, still: ${sourceCount} documents.`);

	if (targetCount !== sourceCount) {
		console.warn("WARNING: target count does not match source count - investigate before proceeding.");
	} else {
		console.log("Verified: source and target counts match.");
	}

	await sourceConn.close();
	await targetConn.close();
};

run().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
