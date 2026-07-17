import { redis } from "../lib/redis.js";
import cloudinary from "../lib/cloudinary.js";
import Product from "../models/product.model.js";
import { parsePagination, paginatedResponse } from "../lib/pagination.js";

export const getAllProducts = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query);
		const [products, total] = await Promise.all([
			Product.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Product.countDocuments({}),
		]);
		res.json(paginatedResponse(products, total, page, limit));
	} catch (error) {
		console.log("Error in getAllProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getFeaturedProducts = async (req, res) => {
	try {
		let featuredProducts = await redis.get("featured_products");
		if (featuredProducts) {
			return res.json(JSON.parse(featuredProducts));
		}

		// if not in redis, fetch from mongodb
		// .lean() is gonna return a plain javascript object instead of a mongodb document
		// which is good for performance
		featuredProducts = await Product.find({ isFeatured: true }).lean();

		if (!featuredProducts) {
			return res.status(404).json({ message: "No featured products found" });
		}

		// store in redis for future quick access - 300s TTL bounds how stale this
		// can get if isFeatured changes outside toggleFeaturedProduct's own cache
		// invalidation

		await redis.set("featured_products", JSON.stringify(featuredProducts), "EX", 300);

		res.json(featuredProducts);
	} catch (error) {
		console.log("Error in getFeaturedProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const createProduct = async (req, res) => {
	try {
		const { name, description, price, image, category } = req.body;

		let cloudinaryResponse = null;

		if (image) {
			cloudinaryResponse = await cloudinary.uploader.upload(image, { folder: "products" });
		}

		const product = await Product.create({
			name,
			description,
			price,
			image: cloudinaryResponse?.secure_url ? cloudinaryResponse.secure_url : "",
			category,
		});

		res.status(201).json(product);
	} catch (error) {
		console.log("Error in createProduct controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const deleteProduct = async (req, res) => {
	try {
		const product = await Product.findById(req.params.id);

		if (!product) {
			return res.status(404).json({ message: "Product not found" });
		}

		if (product.image) {
			const publicId = product.image.split("/").pop().split(".")[0];
			try {
				await cloudinary.uploader.destroy(`products/${publicId}`);
				console.log("deleted image from cloduinary");
			} catch (error) {
				console.log("error deleting image from cloduinary", error);
			}
		}

		await Product.findByIdAndDelete(req.params.id);

		res.json({ message: "Product deleted successfully" });
	} catch (error) {
		console.log("Error in deleteProduct controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getRecommendedProducts = async (req, res) => {
	try {
		const products = await Product.aggregate([
			{
				$sample: { size: 4 },
			},
			{
				$project: {
					_id: 1,
					name: 1,
					description: 1,
					image: 1,
					price: 1,
				},
			},
		]);

		res.json(products);
	} catch (error) {
		console.log("Error in getRecommendedProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// New in Product Service - not present in the monolith. See
// user-service's auth.controller.js#getUserCount for the full rationale:
// each service exposes a small summary of its own data, and the frontend
// composes them client-side in the absence of a Baseline-stage Analytics
// service or Gateway. See docs/decision_log.md.
export const getProductCount = async (req, res) => {
	try {
		const count = await Product.countDocuments();
		res.json({ count });
	} catch (error) {
		console.log("Error in getProductCount controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getProductsByBatch = async (req, res) => {
	try {
		const { ids } = req.body;

		if (!Array.isArray(ids) || ids.length === 0) {
			return res.json([]);
		}

		const products = await Product.find({ _id: { $in: ids } });
		res.json(products);
	} catch (error) {
		console.log("Error in getProductsByBatch controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getProductsByCategory = async (req, res) => {
	const { category } = req.params;
	try {
		const { page, limit, skip } = parsePagination(req.query);
		const [products, total] = await Promise.all([
			Product.find({ category }).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Product.countDocuments({ category }),
		]);
		res.json(paginatedResponse(products, total, page, limit));
	} catch (error) {
		console.log("Error in getProductsByCategory controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const toggleFeaturedProduct = async (req, res) => {
	try {
		const product = await Product.findById(req.params.id);
		if (product) {
			product.isFeatured = !product.isFeatured;
			const updatedProduct = await product.save();
			await updateFeaturedProductsCache();
			res.json(updatedProduct);
		} else {
			res.status(404).json({ message: "Product not found" });
		}
	} catch (error) {
		console.log("Error in toggleFeaturedProduct controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const searchProducts = async (req, res) => {
	try {
		const q = (req.query.q || "").trim();

		if (!q) {
			return res.json(paginatedResponse([], 0, 1, parsePagination(req.query).limit));
		}

		const pattern = escapeRegExp(q);
		const filter = {
			$or: [
				{ name: { $regex: pattern, $options: "i" } },
				{ description: { $regex: pattern, $options: "i" } },
			],
		};

		const { page, limit, skip } = parsePagination(req.query);
		// Note: the $or/$regex filter above is an unanchored substring match,
		// which cannot use the createdAt index (or any standard index) for the
		// filter step - only the sort benefits. See docs/decision_log.md.
		const [products, total] = await Promise.all([
			Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Product.countDocuments(filter),
		]);

		res.json(paginatedResponse(products, total, page, limit));
	} catch (error) {
		console.log("Error in searchProducts controller", error.message);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

async function updateFeaturedProductsCache() {
	try {
		// The lean() method  is used to return plain JavaScript objects instead of full Mongoose documents. This can significantly improve performance

		const featuredProducts = await Product.find({ isFeatured: true }).lean();
		await redis.set("featured_products", JSON.stringify(featuredProducts), "EX", 300);
	} catch (error) {
		console.log("error in update cache function");
	}
}
