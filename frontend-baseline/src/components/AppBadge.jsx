// Non-functional visual indicator of which architecture stage this
// frontend is talking to (Monolith / Baseline / Enhanced). Identical
// component code across frontend/, frontend-baseline/, and
// frontend-enhanced/ - only VITE_APP_LABEL/VITE_APP_COLOR differ per
// frontend's .env. Plain text and CSS only, no images, no network
// requests, so it can't affect any measured metric (startup time, page
// weight, etc.). See docs/DECISION_LOG.md.
const AppBadge = () => {
	const label = import.meta.env.VITE_APP_LABEL;
	const color = import.meta.env.VITE_APP_COLOR;

	if (!label || !color) return null;

	return (
		<div
			style={{
				position: "fixed",
				bottom: "12px",
				right: "12px",
				zIndex: 9999,
				backgroundColor: color,
				color: "#ffffff",
				fontSize: "11px",
				fontWeight: 600,
				padding: "4px 10px",
				borderRadius: "9999px",
				fontFamily: "sans-serif",
				pointerEvents: "none",
				userSelect: "none",
				boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
			}}
		>
			{label}
		</div>
	);
};

export default AppBadge;
