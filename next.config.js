/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

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
	},
	serverExternalPackages: ["pdfkit"],
	// Workspace packages ship TypeScript source (packages/*), not built JS.
	// @retrospend/i18n loads catalogs with import.meta.glob, which only
	// Turbopack supports: `next build --webpack` (and ANALYZE=true) loses translations.
	transpilePackages: [
		"@retrospend/api-contract",
		"@retrospend/domain",
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
