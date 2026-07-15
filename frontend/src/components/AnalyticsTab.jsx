import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import axios from "../lib/axios";
import { Users, Package, ShoppingCart, DollarSign } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const AnalyticsTab = () => {
	const [analyticsData, setAnalyticsData] = useState({
		users: 0,
		products: 0,
		totalSales: 0,
		totalRevenue: 0,
	});
	const [isLoading, setIsLoading] = useState(true);
	const [dailySalesData, setDailySalesData] = useState([]);

	useEffect(() => {
		const fetchAnalyticsData = async () => {
			try {
				const response = await axios.get("/analytics");
				setAnalyticsData(response.data.analyticsData);
				setDailySalesData(response.data.dailySalesData);
			} catch (error) {
				console.error("Error fetching analytics data:", error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchAnalyticsData();
	}, []);

	if (isLoading) {
		return <div>Loading...</div>;
	}

	return (
		<div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
			<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8'>
				<AnalyticsCard
					title='Total Users'
					value={analyticsData.users.toLocaleString()}
					icon={Users}
					color='from-orange-500 to-gray-900'
				/>
				<AnalyticsCard
					title='Total Products'
					value={analyticsData.products.toLocaleString()}
					icon={Package}
					color='from-orange-400 to-orange-100 dark:from-orange-500 dark:to-gray-800'
				/>
				<AnalyticsCard
					title='Total Sales'
					value={analyticsData.totalSales.toLocaleString()}
					icon={ShoppingCart}
					color='from-orange-500 to-gray-900'
				/>
				<AnalyticsCard
					title='Total Revenue'
					value={`$${analyticsData.totalRevenue.toLocaleString()}`}
					icon={DollarSign}
					color='from-orange-400 to-orange-100 dark:from-orange-500 dark:to-gray-800'
				/>
			</div>
			<motion.div
				className='bg-white/60 dark:bg-gray-800/60 rounded-lg p-6 shadow-lg'
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.25 }}
			>
				<ResponsiveContainer width='100%' height={400}>
					<LineChart data={dailySalesData}>
						<CartesianGrid stroke='#9CA3AF' strokeDasharray='3 3' />

<XAxis
	dataKey='name'
	stroke={document.documentElement.classList.contains("dark")
		? "#D1D5DB"
		: "#374151"}
/>

<YAxis
	yAxisId='left'
	stroke={document.documentElement.classList.contains("dark")
		? "#D1D5DB"
		: "#374151"}
/>

<YAxis
	yAxisId='right'
	orientation='right'
	stroke={document.documentElement.classList.contains("dark")
		? "#D1D5DB"
		: "#374151"}
/>
						<Tooltip
	contentStyle={{
		backgroundColor: document.documentElement.classList.contains("dark")
			? "#1F2937"
			: "#FFFFFF",
		border: "1px solid #F97316",
		borderRadius: "8px",
		color: document.documentElement.classList.contains("dark")
			? "#FFFFFF"
			: "#111827",
	}}
/>
						<Legend />
						<Line
							yAxisId='left'
							type='monotone'
							dataKey='sales'
							stroke='#F97316'
							activeDot={{ r: 8 }}
							name='Sales'
						/>
						<Line
							yAxisId='right'
							type='monotone'
							dataKey='revenue'
							stroke='#EAB308'
							activeDot={{ r: 8 }}
							name='Revenue'
						/>
					</LineChart>
				</ResponsiveContainer>
			</motion.div>
		</div>
	);
};
export default AnalyticsTab;

const AnalyticsCard = ({ title, value, icon: Icon, color }) => (
	<motion.div
		className={`bg-white dark:bg-gray-800
	rounded-lg p-6 shadow-lg overflow-hidden relative
	border border-orange-300 dark:border-gray-800 ${color}`}
		initial={{ opacity: 0, y: 20 }}
		animate={{ opacity: 1, y: 0 }}
		transition={{ duration: 0.5 }}
	>
		<div className='flex justify-between items-center'>
			<div className='z-10'>
				<p className='text-orange-600 dark:text-yellow-400 text-sm mb-1 font-semibold'> {title}</p>
				<h3 className='text-gray-900 dark:text-white text-3xl font-bold'> {value} </h3>
			</div>
		</div>
		<div className='absolute inset-0 bg-gradient-to-br from-orange-100 to-yellow-50 dark:from-orange-500 dark:to-gray-900 opacity-60 dark:opacity-30'/>
		<div className='absolute -bottom-4 -right-4	text-orange-200 dark:text-orange-300 opacity-40 dark:opacity-50'>
			<Icon className='h-32 w-32' />
		</div>
	</motion.div>
);
