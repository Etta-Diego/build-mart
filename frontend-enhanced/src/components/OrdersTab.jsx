import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { orderApi } from "../lib/api";

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];

// Larger than the 12 used for customer-facing product grids/search: this is
// an internal admin tool where scanning more rows at once (fewer clicks)
// matters more than the visual density concerns of a product grid - see
// docs/decision_log.md.
const ORDERS_PAGE_SIZE = 20;

const OrdersTab = () => {
	const [orders, setOrders] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [error, setError] = useState(null);
	const [pagination, setPagination] = useState({ total: 0, page: 1, limit: ORDERS_PAGE_SIZE, hasMore: false });

	const fetchOrders = async (page) => {
		const response = await orderApi.get(`/all?page=${page}&limit=${ORDERS_PAGE_SIZE}`);
		const { data, total, limit, hasMore } = response.data;
		setOrders((prev) => (page === 1 ? data : [...prev, ...data]));
		setPagination({ total, page, limit, hasMore });
	};

	useEffect(() => {
		(async () => {
			try {
				await fetchOrders(1);
			} catch (err) {
				console.error("Error fetching orders:", err);
				setError(err.response?.data?.message || "Failed to load orders");
			} finally {
				setIsLoading(false);
			}
		})();
	}, []);

	const handleLoadMore = async () => {
		setIsLoadingMore(true);
		try {
			await fetchOrders(pagination.page + 1);
		} catch (err) {
			console.error("Error fetching orders:", err);
		} finally {
			setIsLoadingMore(false);
		}
	};

	const handleStatusChange = async (orderId, status) => {
		try {
			const response = await orderApi.patch(`/${orderId}/status`, { status });
			setOrders((prev) => prev.map((order) => (order._id === orderId ? response.data : order)));
		} catch (err) {
			console.error("Error updating order status:", err);
		}
	};

	if (isLoading) {
		return <div>Loading...</div>;
	}

	if (error) {
		return <div className='text-red-500 text-center'>{error}</div>;
	}

	return (
		<>
		<motion.div
			className='bg-[#111827] shadow-lg rounded-lg overflow-hidden max-w-6xl mx-auto border border-gray-700'
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.8 }}
		>
			<table className=' min-w-full divide-y divide-gray-700'>
				<thead className='bg-orange-500'>
					<tr>
						<th
							scope='col'
							className='px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider'
						>
							User
						</th>
						<th
							scope='col'
							className='px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider'
						>
							Products
						</th>
						<th
							scope='col'
							className='px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider'
						>
							Total
						</th>
						<th
							scope='col'
							className='px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider'
						>
							Status
						</th>
						<th
							scope='col'
							className='px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider'
						>
							Date
						</th>
					</tr>
				</thead>

				<tbody className='bg-white dark:bg-gray-800 divide-y divide-gray-700'>
					{orders.map((order) => (
						<tr key={order._id} className='bg-orange-500/10 transition-colors duration-200'>
							<td className='px-6 py-4 whitespace-nowrap'>
								<div className='text-sm font-medium text-gray-900 dark:text-white'>
									{order.user?.name ?? "Unknown"}
								</div>
								<div className='text-sm text-gray-500 dark:text-gray-400'>{order.user?.email ?? ""}</div>
							</td>
							<td className='px-6 py-4'>
								<div className='text-sm text-gray-900 dark:text-white'>
									{order.products.map((item, index) => (
										<div key={item.product?._id ?? index}>
											{item.product?.name ?? "Deleted product"} × {item.quantity}
										</div>
									))}
								</div>
							</td>
							<td className='px-6 py-4 whitespace-nowrap'>
								<div className='text-sm text-orange-400 font-semibold'>${order.totalAmount.toFixed(2)}</div>
							</td>
							<td className='px-6 py-4 whitespace-nowrap'>
								<select
									value={order.status}
									onChange={(e) => handleStatusChange(order._id, e.target.value)}
									className='bg-gray-700 text-white text-sm rounded-md px-2 py-1 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500'
								>
									{ORDER_STATUSES.map((status) => (
										<option key={status} value={status}>
											{status}
										</option>
									))}
								</select>
							</td>
							<td className='px-6 py-4 whitespace-nowrap'>
								<div className='text-sm text-gray-500 dark:text-gray-400'>
									{new Date(order.createdAt).toLocaleDateString()}
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</motion.div>
		{pagination.hasMore && (
			<div className='flex justify-center mt-6'>
				<button
					onClick={handleLoadMore}
					disabled={isLoadingMore}
					className='bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-6 py-2 rounded-md font-medium transition duration-300 ease-in-out'
				>
					{isLoadingMore ? "Loading..." : "Load More"}
				</button>
			</div>
		)}
		</>
	);
};
export default OrdersTab;
