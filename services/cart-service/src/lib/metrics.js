import client from "prom-client";

const processStartTime = Date.now();

export const register = new client.Registry();

const appStartupDurationSeconds = new client.Gauge({
	name: "app_startup_duration_seconds",
	help: "Time from process start to application ready (server listening and MongoDB connected)",
	registers: [register],
});

const appReadyTimestampSeconds = new client.Gauge({
	name: "app_ready_timestamp_seconds",
	help: "Unix timestamp at which the application became ready",
	registers: [register],
});

export function markReady() {
	const now = Date.now();
	appStartupDurationSeconds.set((now - processStartTime) / 1000);
	appReadyTimestampSeconds.set(now / 1000);
}

const httpRequestDurationSeconds = new client.Histogram({
	name: "http_request_duration_seconds",
	help: "Duration of HTTP requests in seconds",
	labelNames: ["method", "route", "status_code"],
	buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
	registers: [register],
});

const httpRequestsTotal = new client.Counter({
	name: "http_requests_total",
	help: "Total number of HTTP requests",
	labelNames: ["method", "route", "status_code"],
	registers: [register],
});

export function metricsMiddleware(req, res, next) {
	const start = process.hrtime.bigint();

	res.on("finish", () => {
		const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
		const route = req.route ? `${req.baseUrl}${req.route.path}` : req.originalUrl.split("?")[0];
		const labels = { method: req.method, route, status_code: res.statusCode };

		httpRequestDurationSeconds.observe(labels, durationSeconds);
		httpRequestsTotal.inc(labels);
	});

	next();
}

new client.Gauge({
	name: "process_memory_usage_bytes",
	help: "Process memory usage by type, from process.memoryUsage()",
	labelNames: ["type"],
	registers: [register],
	collect() {
		const mem = process.memoryUsage();
		this.set({ type: "rss" }, mem.rss);
		this.set({ type: "heapTotal" }, mem.heapTotal);
		this.set({ type: "heapUsed" }, mem.heapUsed);
		this.set({ type: "external" }, mem.external);
	},
});

new client.Gauge({
	name: "process_cpu_usage_seconds",
	help: "Cumulative process CPU usage in seconds, from process.cpuUsage()",
	labelNames: ["type"],
	registers: [register],
	collect() {
		const cpu = process.cpuUsage();
		this.set({ type: "user" }, cpu.user / 1e6);
		this.set({ type: "system" }, cpu.system / 1e6);
	},
});
