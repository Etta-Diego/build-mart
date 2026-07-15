const LoadingSpinner = () => {
	return (
		<div className='flex items-center justify-center min-h-screen bg-[#111827]'>
			<div className='relative'>
				<div className='w-20 h-20 border-gray-700 border-4 rounded-full' />
				<div className='w-20 h-20 border-orange-500 border-t-4 animate-spin rounded-full absolute left-0 top-0' />
				<div className='sr-only'>Loading</div>
			</div>
		</div>
	);
};

export default LoadingSpinner;
