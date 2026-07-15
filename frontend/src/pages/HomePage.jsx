import { useEffect } from "react";
import CategoryItem from "../components/CategoryItem";
import { useProductStore } from "../stores/useProductStore";
import FeaturedProducts from "../components/FeaturedProducts";

const categories = [
	{ href: "/cement", name: "Cement", imageUrl: "/cement.jpg" },
	{ href: "/rods", name: "Rods", imageUrl: "/rods.jpg" },
	{ href: "/pipes", name: "Pipes", imageUrl: "/pipes.jpg" },
	{ href: "/roofing-sheet", name: "Roofing Sheet", imageUrl: "/roofing.jpg" },
	{ href: "/plank", name: "Plank", imageUrl: "/planks.jpg" },
	{ href: "/water-tank", name: "Water Tank", imageUrl: "/tank.jpg" },
	{ href: "/wall-paints", name: "Wall Paints", imageUrl: "/paints.jpg" },
];

const HomePage = () => {
	const { fetchFeaturedProducts, products, isLoading } = useProductStore();

	useEffect(() => {
		fetchFeaturedProducts();
	}, [fetchFeaturedProducts]);

	return (
		<div className='relative min-h-screen text-white overflow-hidden'>
			<div className='relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16'>
				<h1 className='text-center text-5xl sm:text-6xl font-bold text-orange-400 mb-4'>
					Explore Our Categories
				</h1>
				<p className='text-center text-xl text-black dark:text-gray-200 mb-12'>
					Premium tools and equipment for every construction project
				</p>

				<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
					{categories.map((category) => (
						<CategoryItem category={category} key={category.name} />
					))}
				</div>

				{!isLoading && products.length > 0 && <FeaturedProducts featuredProducts={products} />}
			</div>
		</div>
	);
};
export default HomePage;
