import { Moon, Sun, ShoppingCart, UserPlus, LogIn, LogOut, Lock, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUserStore } from "../stores/useUserStore";
import { useCartStore } from "../stores/useCartStore";

// How long to wait after the user stops typing before navigating to the
// search results page - keeps a keystroke from firing a request on every
// character. Named so it's easy to find/tune later, not a magic number
// buried in the effect below.
const SEARCH_DEBOUNCE_MS = 300;

const Navbar = () => {
	const { user, logout } = useUserStore();
	const isAdmin = user?.role === "admin";
	const { cart } = useCartStore();
	const navigate = useNavigate();
	const [searchInput, setSearchInput] = useState("");
	const [darkMode, setDarkMode] = useState(
	localStorage.getItem("theme") === "dark"
);

useEffect(() => {
	if (darkMode) {
		document.documentElement.classList.add("dark");
		localStorage.setItem("theme", "dark");
	} else {
		document.documentElement.classList.remove("dark");
		localStorage.setItem("theme", "light");
	}
}, [darkMode]);

useEffect(() => {
	const trimmed = searchInput.trim();
	if (!trimmed) return;

	const timeoutId = setTimeout(() => {
		navigate(`/search?q=${encodeURIComponent(trimmed)}`, { replace: true });
	}, SEARCH_DEBOUNCE_MS);

	return () => clearTimeout(timeoutId);
}, [searchInput, navigate]);

	return (
		<header className='fixed top-0 left-0 w-full bg-gray-900 bg-opacity-90 backdrop-blur-md shadow-lg z-40 transition-all duration-300 border-b border-orange-300'>
			<div className='container mx-auto px-4 py-3'>
				<div className='flex flex-wrap justify-between items-center'>
					<Link to='/' className='text-2xl font-bold text-orange-500 items-center space-x-2 flex'>
						BuildMart
					</Link>

					<nav className='flex flex-wrap items-center gap-4'>
						<Link
							to={"/"}
							className='text-gray-300 hover:text-orange-500 transition duration-300
					 ease-in-out'
						>
							Home
						</Link>
						<div className='relative'>
							<Search className='absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none' />
							<input
								type='text'
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								placeholder='Search products...'
								className='pl-8 pr-3 py-1.5 rounded-md bg-gray-700 text-white placeholder-gray-400 text-sm
								focus:outline-none focus:ring-2 focus:ring-orange-500 w-40 sm:w-56'
							/>
						</div>
						<button
	onClick={() => setDarkMode(!darkMode)}
	className='p-2 rounded-md bg-gray-700 hover:bg-gray-600 transition'
>
	{darkMode ? (
		<Sun className='w-5 h-5 text-yellow-400' />
	) : (
		<Moon className='w-5 h-5 text-white' />
	)}
</button>
						{user && !isAdmin && (
							<Link
								to={"/cart"}
								className='relative group text-gray-300 hover:text-orange-500 transition duration-300 
							ease-in-out'
							>
								<ShoppingCart className='inline-block mr-1 group-hover:text-orange-500' size={20} />
								<span className='hidden sm:inline'>Cart</span>
								{cart.length > 0 && (
									<span
										className='absolute -top-2 -left-2 bg-orange-500 text-white rounded-full px-2 py-0.5 
									text-xs group-hover:bg-orange-300 transition duration-300 ease-in-out'
									>
										{cart.length}
									</span>
								)}
							</Link>
						)}
						{isAdmin && (
							<Link
								className='bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-md font-medium
								 transition duration-300 ease-in-out flex items-center'
								to={"/secret-dashboard"}
							>
								<Lock className='inline-block mr-1' size={18} />
								<span className='hidden sm:inline'>Dashboard</span>
							</Link>
						)}

						{user ? (
							<button
								className='bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 
						rounded-md flex items-center transition duration-300 ease-in-out'
								onClick={logout}
							>
								<LogOut size={18} />
								<span className='hidden sm:inline ml-2'>Log Out</span>
							</button>
						) : (
							<>
								<Link
									to={"/signup"}
									className='bg-orange-500 hover:bg-yellow-500 text-white py-2 px-4 
									rounded-md flex items-center transition duration-300 ease-in-out'
								>
									<UserPlus className='mr-2' size={18} />
									Sign Up
								</Link>
								<Link
									to={"/login"}
									className='bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 
									rounded-md flex items-center transition duration-300 ease-in-out'
								>
									<LogIn className='mr-2' size={18} />
									Login
								</Link>
							</>
						)}
					</nav>
				</div>
			</div>
		</header>
	);
};
export default Navbar;
