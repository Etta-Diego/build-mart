import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import axios from "../lib/axios";

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];

const OrdersTab = () => {
	const [orders, setOrders] = useState([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const fetchOrders = async () => {
			try {
				const response = await axios.get("/orders/all");
				setOrders(response.data);
			} catch (error) {
				console.error("Error fetching orders:", error);
			} finally {
				setIsLoading(false);
			}
		};

		fetchOrders();
	}, []);

	const handleStatusChange = async (orderId, status) => {
		try {
			const response = await axios.patch(`/orders/${orderId}/status`, { status });
			setOrders((prev) => prev.map((order) => (order._id === orderId ? response.data : order)));
		} catch (error) {
			console.error("Error updating order status:", error);
		}
	};

	if (isLoading) {
		return <div>Loading...</div>;
	}

	return (
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
	);
};
export default OrdersTab;
