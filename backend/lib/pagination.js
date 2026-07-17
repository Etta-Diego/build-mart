// One consistent pagination contract used by every list-returning endpoint
// (products, category browse, search, user orders, admin orders) - see
// docs/decision_log.md for why a shared helper exists instead of five
// slightly different skip/limit implementations.

export function parsePagination(query, { defaultLimit = 12, maxLimit = 100 } = {}) {
	const page = Math.max(1, parseInt(query.page, 10) || 1);
	const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
	const skip = (page - 1) * limit;
	return { page, limit, skip };
}

export function paginatedResponse(data, total, page, limit) {
	return {
		data,
		total,
		page,
		limit,
		hasMore: page * limit < total,
	};
}
