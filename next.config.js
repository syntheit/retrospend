/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
	output: "standalone",
	env: {
		NEXT_PUBLIC_SHOW_LANDING_PAGE: process.env.SHOW_LANDING_PAGE ?? "false",
		NEXT_PUBLIC_ENABLE_LEGAL_PAGES: process.env.ENABLE_LEGAL_PAGES ?? "false",
	},
	experimental: {
		externalDir: true,
	},
	devIndicators: {
		position: "bottom-right",
	},
};

export default config;
