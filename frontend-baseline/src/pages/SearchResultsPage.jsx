import { useEffect } from "react";
import { useProductStore } from "../stores/useProductStore";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import ProductCard from "../components/ProductCard";

const SearchResultsPage = () => {
	const { searchProducts, products, pagination, loading } = useProductStore();

	const [searchParams] = useSearchParams();
	const q = searchParams.get("q") || "";

	useEffect(() => {
		searchProducts(q);
	}, [searchProducts, q]);

	const handleLoadMore = () => {
		searchProducts(q, { page: pagination.page + 1 });
	};

	return (
		<div className='min-h-screen'>
			<div className='relative z-10 max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-16'>
				<motion.h1
					className='text-center text-4xl sm:text-5xl font-bold text-orange-500 mb-8'
					initial={{ opacity: 0, y: -20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8 }}
				>
					{q ? `Search results for "${q}"` : "Search"}
				</motion.h1>

				<motion.div
					className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 justify-items-center'
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8, delay: 0.2 }}
				>
					{!q && (
						<h2 className='text-3xl font-semibold text-yellow-400 text-center col-span-full'>
							Type something to search
						</h2>
					)}

					{q && products?.length === 0 && (
						<h2 className='text-3xl font-semibold text-yellow-400 text-center col-span-full'>
							No products found
						</h2>
					)}

					{q && products?.map((product) => <ProductCard key={product._id} product={product} />)}
				</motion.div>

				{q && pagination.hasMore && (
					<div className='flex justify-center mt-10'>
						<button
							onClick={handleLoadMore}
							disabled={loading}
							className='bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-6 py-2 rounded-md font-medium transition duration-300 ease-in-out'
						>
							{loading ? "Loading..." : "Load More"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
};
export default SearchResultsPage;
