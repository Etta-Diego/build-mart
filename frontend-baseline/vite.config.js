import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No dev-server proxy here (unlike the monolith's frontend/vite.config.js,
// which proxies /api to the monolith on :5000) - lib/api.js calls each of
// the five Baseline Microservices directly via their own absolute URLs,
// relying on each service's own CORS configuration rather than a proxy.
// See docs/DECISION_LOG.md.
// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
});
