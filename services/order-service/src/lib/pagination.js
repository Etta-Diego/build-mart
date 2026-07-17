// One consistent pagination contract used by every list-returning endpoint
// in this service. Duplicated into product-service's own lib/ rather than
// shared, consistent with this project's service-independence rule (see
// auth.middleware.js in every service) - see docs/decision_log.md.

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
