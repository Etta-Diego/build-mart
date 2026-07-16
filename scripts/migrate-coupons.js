// One-off migration script - copies all documents from the monolith's
// `buildmart` database `coupons` collection into the new, separate
// `coupon-service-db` database (same Atlas cluster), as part of the
// Stage 2 Coupon Service extraction. Idempotent (skips documents whose
// _id already exists in the target) and additive only - never deletes or
// modifies anything in the source `buildmart` database. Source is
// expected to be empty (0 documents, confirmed prior to writing this
// script) - that is a valid, non-error outcome, not a failure. Not wired
// into the app.
//   node scripts/migrate-coupons.js

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

// Swap only the database name segment (.../buildmart? -> .../coupon-service-db?)
// so both connections point at the same Atlas cluster.
const TARGET_URI = SOURCE_URI.replace(/\/buildmart(\?|$)/, "/coupon-service-db$1");
if (TARGET_URI === SOURCE_URI) {
	console.error("Could not derive target URI - expected '/buildmart' in MONGO_URI. Aborting.");
	process.exit(1);
}

const run = async () => {
	const sourceConn = await mongoose.createConnection(SOURCE_URI).asPromise();
	const targetConn = await mongoose.createConnection(TARGET_URI).asPromise();
	console.log("Connected to source (buildmart) and target (coupon-service-db).");

	const sourceCoupons = sourceConn.collection("coupons");
	const targetCoupons = targetConn.collection("coupons");

	const sourceDocs = await sourceCoupons.find({}).toArray();
	const sourceCount = sourceDocs.length;
	console.log(`Source coupons collection: ${sourceCount} documents.`);

	if (sourceCount === 0) {
		console.log("Source is empty - nothing to migrate. This is expected, not an error.");
		console.log("Inserted: 0, skipped: 0.");
		await sourceConn.close();
		await targetConn.close();
		return;
	}

	const existingIds = new Set((await targetCoupons.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id.toString()));

	const toInsert = sourceDocs.filter((doc) => !existingIds.has(doc._id.toString()));
	const skipped = sourceCount - toInsert.length;

	if (toInsert.length > 0) {
		await targetCoupons.insertMany(toInsert);
	}

	const targetCount = await targetCoupons.countDocuments();

	console.log(`Inserted: ${toInsert.length}, skipped (already present): ${skipped}`);
	console.log(`Target coupons collection now has: ${targetCount} documents.`);
	console.log(`Source (buildmart.coupons) untouched, still: ${sourceCount} documents.`);

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
