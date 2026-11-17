/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import { WORKER_CSP } from "./src/lib/worker-csp.js";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === "true",
});

/** @type {import("next").NextConfig} */
const config = {
	output: "standalone",
	env: {
		NEXT_PUBLIC_APP_URL:
			process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL,
		NEXT_PUBLIC_SHOW_LANDING_PAGE: process.env.SHOW_LANDING_PAGE ?? "false",
		NEXT_PUBLIC_ENABLE_LEGAL_PAGES: process.env.ENABLE_LEGAL_PAGES ?? "true",
		// Always defined, so the build can replace the literal in
		// lib/device-engine/load.ts and drop the dynamic import when it is not "1".
		NEXT_PUBLIC_DEV_DEVICE_ENGINE:
			process.env.NEXT_PUBLIC_DEV_DEVICE_ENGINE ?? "",
	},
	serverExternalPackages: ["pdfkit"],
	// Workspace packages ship TypeScript source (packages/*), not built JS.
	// @retrospend/i18n loads catalogs with import.meta.glob, which only
	// Turbopack supports: `next build --webpack` (and ANALYZE=true) loses translations.
	transpilePackages: [
		"@retrospend/api-client",
		"@retrospend/api-contract",
		"@retrospend/domain",
		"@retrospend/engine",
		"@retrospend/i18n",
	],
	experimental: {
		externalDir: true,
		// Next buffers a request body for proxy.ts and cuts it at 10 MB by default,
		// so a 10 MB import would arrive truncated. Just above the v1 upload cap
		// (MULTIPART_LIMIT, 11 MB), which then answers 413 itself.
		proxyClientMaxBodySize: "12mb",
		optimizePackageImports: ["recharts", "@tabler/icons-react", "lucide-react", "date-fns"],
	},
	// Routes of the old UI. Bookmarks, emails and old links land on the new
	// pages, with the query string kept.
	redirects() {
		return [
			{ source: "/dashboard", destination: "/home", permanent: true },
			{ source: "/transactions", destination: "/activity", permanent: true },
			{
				source: "/recurring",
				destination: "/activity/recurring",
				permanent: true,
			},
			// Addresses only the phone apps open (app links): the bell and an
			// expense have no page of their own on the web.
			{ source: "/notifications", destination: "/home", permanent: false },
			{ source: "/entries/:id", destination: "/activity", permanent: false },
		];
	},
	// The device worker (dev flag) is a classic worker whose chunks Turbopack
	// serves under /_next/static/chunks. The browser applies the CSP of the
	// response a worker loads from, and the proxy skips /_next/static, so the
	// worker would run with none. CSP on a response that is neither a document
	// nor a worker is ignored, so the policy is harmless on the page's other
	// chunks. Turbopack has no narrower target for the worker's entry.
	headers() {
		return [
			{
				source: "/_next/static/chunks/:path*",
				headers: [{ key: "Content-Security-Policy", value: WORKER_CSP }],
			},
		];
	},
	devIndicators: {
		position: "bottom-right",
	},
	// Dev-only: allow the dev server to be reached over Tailscale (by hostname
	// or IP). Ignored by `next build`/`next start`, so production is unaffected.
	...(process.env.NODE_ENV === "development"
		? { allowedDevOrigins: ["harbor", "100.109.63.87", "localhost"] }
		: {}),
};

export default withNextIntl(withBundleAnalyzer(config));
