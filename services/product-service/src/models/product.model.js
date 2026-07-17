import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
		},
		description: {
			type: String,
			required: true,
		},
		price: {
			type: Number,
			min: 0,
			required: true,
		},
		image: {
			type: String,
			required: [true, "Image is required"],
		},
		category: {
			type: String,
			required: true,
		},
		isFeatured: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true }
);

// Mirrors backend/models/product.model.js (v1.4-monolith-baseline):
// category/isFeatured back getProductsByCategory and
// getFeaturedProducts/updateFeaturedProductsCache's filter lookups;
// createdAt backs the stable sort pagination will rely on once added
// (Stage 2 Part 2) - see docs/decision_log.md.
productSchema.index({ category: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ createdAt: -1 });

const Product = mongoose.model("Product", productSchema);

export default Product;
