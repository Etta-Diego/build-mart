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

// category/isFeatured are the two filters used for browsing/curation
// lookups (getProductsByCategory, getFeaturedProducts); createdAt backs
// the stable sort pagination relies on (skip/limit needs a deterministic
// order or page boundaries can return duplicate/missing items) - see
// docs/decision_log.md.
productSchema.index({ category: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ createdAt: -1 });

const Product = mongoose.model("Product", productSchema);

export default Product;
