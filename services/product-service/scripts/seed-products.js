// One-off seed script for manual/local testing - creates realistic
// building-material products with images actually uploaded to Cloudinary.
// Not wired into the app or package.json scripts. Run directly, from
// THIS service's own directory (so src/lib/db.js and src/lib/cloudinary.js's
// own bare dotenv.config() calls resolve services/product-service/.env at
// import time - see docs/decision_log.md):
//   cd services/product-service && node scripts/seed-products.js
//
// Baseline-native adaptation of the Monolith's scripts/seed-products.js:
// uses product-service's own db/cloudinary/model modules and its own
// .env, instead of reaching into ../backend/.

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { connectDB } from "../src/lib/db.js";
import cloudinary from "../src/lib/cloudinary.js";
import Product from "../src/models/product.model.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// category values must match the URL slugs in frontend-baseline/src/pages/HomePage.jsx's
// `categories` array (e.g. href: "/cement" -> category param "cement"), since
// getProductsByCategory does an exact string match against this field.
const ORIGINAL_PRODUCTS = [
	{
		name: "Portland Cement (50kg Bag)",
		description: "General-purpose Portland cement for concrete, mortar, and rendering work.",
		price: 12.99,
		category: "cement",
		image: "cement.jpg",
		isFeatured: true,
	},
	{
		name: "Weatherproof Exterior Paint (20L)",
		description: "Durable weatherproof paint formulated to protect exterior walls from sun and rain.",
		price: 84.5,
		category: "wall-paints",
		image: "paints.jpg",
		isFeatured: true,
	},
	{
		name: "PVC Plumbing Pipe (6m length)",
		description: "Rigid PVC pipe suitable for cold water supply and drainage installations.",
		price: 18.75,
		category: "pipes",
		image: "pipes.jpg",
		isFeatured: true,
	},
	{
		name: "Treated Timber Plank (2x4, 3m)",
		description: "Pressure-treated timber plank resistant to rot, ideal for framing and outdoor structures.",
		price: 14.25,
		category: "plank",
		image: "planks.jpg",
		isFeatured: true,
	},
	{
		name: "Reinforcement Steel Rod (12mm, 6m)",
		description: "High-tensile deformed steel rebar for reinforcing concrete structures.",
		price: 9.6,
		category: "rods",
		image: "rods.jpg",
		isFeatured: true,
	},
	{
		name: "Corrugated Roofing Sheet",
		description: "Galvanized corrugated steel sheet for durable, weather-resistant roofing.",
		price: 22.4,
		category: "roofing-sheet",
		image: "roofing.jpg",
		isFeatured: true,
	},
	{
		name: "1000L Water Storage Tank",
		description: "Food-grade polyethylene tank for household or site water storage.",
		price: 145.0,
		category: "water-tank",
		image: "tank.jpg",
		isFeatured: true,
	},
];

// 20 additional products - genuinely distinct items within each existing
// category (not renamed duplicates), so category pages have real variety
// to browse. Not marked featured. There are no new source images
// available, so each product reuses its own category's existing source
// image (e.g. every "cement" product uses cement.jpg) - still uploaded as
// its own distinct Cloudinary asset per product.
//
// Distribution: 3 new per category for 6 categories (-> 4 total each),
// 2 new for water-tank (-> 3 total) to land on exactly 20 - tanks have
// less realistic product-line variety than the other categories, so
// water-tank is the one that comes up one short of the 4-5 target.
const ADDITIONAL_PRODUCTS_BASE = [
	{
		name: "Quick-Setting Cement (25kg Bag)",
		description: "Rapid-curing cement designed for urgent repairs and time-sensitive pours.",
		price: 9.75,
		category: "cement",
	},
	{
		name: "White Cement (25kg Bag)",
		description: "Premium white cement for decorative finishes, tiling, and architectural detailing.",
		price: 17.5,
		category: "cement",
	},
	{
		name: "Waterproof Cement (25kg Bag)",
		description: "Cement blended with waterproofing additives, suited to basements, tanks, and damp-prone areas.",
		price: 14.2,
		category: "cement",
	},
	{
		name: "Interior Matte Emulsion Paint (10L)",
		description: "Low-sheen matte emulsion paint for interior walls and ceilings.",
		price: 38.0,
		category: "wall-paints",
	},
	{
		name: "High-Gloss Enamel Paint (4L)",
		description: "Durable gloss enamel paint for doors, window frames, and metal fixtures.",
		price: 27.5,
		category: "wall-paints",
	},
	{
		name: "Anti-Fungal Bathroom Paint (10L)",
		description: "Moisture-resistant paint formulated to resist mould and mildew in bathrooms and kitchens.",
		price: 45.0,
		category: "wall-paints",
	},
	{
		name: "PVC Drainage Pipe (110mm, 4m)",
		description: "Wide-bore PVC pipe for wastewater and drainage systems.",
		price: 16.9,
		category: "pipes",
	},
	{
		name: "Copper Water Pipe (15mm, 3m)",
		description: "Corrosion-resistant copper pipe for hot and cold water supply lines.",
		price: 24.6,
		category: "pipes",
	},
	{
		name: "Flexible Conduit Pipe (25mm, 10m)",
		description: "Flexible electrical conduit pipe for cable protection and routing.",
		price: 12.4,
		category: "pipes",
	},
	{
		name: "Marine Plywood Sheet (18mm)",
		description: "Water-resistant plywood sheet suited to marine and exterior applications.",
		price: 52.0,
		category: "plank",
	},
	{
		name: "Untreated Pine Plank (2x6, 3m)",
		description: "Raw pine plank for interior joinery, shelving, and general carpentry.",
		price: 15.8,
		category: "plank",
	},
	{
		name: "Hardwood Decking Board (3m)",
		description: "Dense hardwood board for durable outdoor decking.",
		price: 29.9,
		category: "plank",
	},
	{
		name: "Reinforcement Steel Rod (8mm, 6m)",
		description: "Lighter-gauge rebar suited to smaller concrete reinforcement jobs.",
		price: 6.9,
		category: "rods",
	},
	{
		name: "Reinforcement Steel Rod (16mm, 6m)",
		description: "Heavy-duty rebar for load-bearing structural reinforcement.",
		price: 15.2,
		category: "rods",
	},
	{
		name: "Galvanized Binding Wire Rod (2mm, coil)",
		description: "Zinc-coated wire rod for tying rebar and general binding work.",
		price: 5.4,
		category: "rods",
	},
	{
		name: "Aluminum Roofing Sheet",
		description: "Lightweight, rust-resistant aluminum sheet for long-lasting roof coverage.",
		price: 28.0,
		category: "roofing-sheet",
	},
	{
		name: "Insulated Sandwich Roofing Panel",
		description: "Foam-core panel combining roofing and thermal insulation in one layer.",
		price: 54.5,
		category: "roofing-sheet",
	},
	{
		name: "Bitumen Roofing Shingles (Bundle)",
		description: "Flexible bitumen shingles for pitched roof coverings.",
		price: 34.75,
		category: "roofing-sheet",
	},
	{
		name: "500L Water Storage Tank",
		description: "Compact polyethylene tank suited to smaller households or sites.",
		price: 92.0,
		category: "water-tank",
	},
	{
		name: "2500L Water Storage Tank",
		description: "High-capacity polyethylene tank for bulk water storage needs.",
		price: 245.0,
		category: "water-tank",
	},
];

const CATEGORY_IMAGES = {
	cement: "cement.jpg",
	"wall-paints": "paints.jpg",
	pipes: "pipes.jpg",
	plank: "planks.jpg",
	rods: "rods.jpg",
	"roofing-sheet": "roofing.jpg",
	"water-tank": "tank.jpg",
};

const ADDITIONAL_PRODUCTS = ADDITIONAL_PRODUCTS_BASE.map((item) => ({
	...item,
	image: CATEGORY_IMAGES[item.category],
	isFeatured: false,
}));

const PRODUCTS = [...ORIGINAL_PRODUCTS, ...ADDITIONAL_PRODUCTS];

async function seed() {
	await connectDB();

	let created = 0;
	let skipped = 0;

	for (const item of PRODUCTS) {
		const existing = await Product.findOne({ name: item.name });
		if (existing) {
			console.log(`SKIP (already exists): ${item.name}`);
			skipped++;
			continue;
		}

		const imagePath = path.resolve(__dirname, "../../../frontend-baseline/public", item.image);
		const cloudinaryResponse = await cloudinary.uploader.upload(imagePath, { folder: "products" });

		await Product.create({
			name: item.name,
			description: item.description,
			price: item.price,
			category: item.category,
			image: cloudinaryResponse.secure_url,
			isFeatured: item.isFeatured,
		});

		console.log(`CREATED: ${item.name} -> ${cloudinaryResponse.secure_url}`);
		created++;
	}

	console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}`);

	const counts = await Product.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
	console.log("\nProducts per category:");
	counts.forEach((c) => console.log(`  ${c._id}: ${c.count}`));

	await mongoose.disconnect();
}

seed().catch((error) => {
	console.error("Seed script failed:", error);
	process.exit(1);
});
