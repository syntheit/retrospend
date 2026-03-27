import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react(), tsconfigPaths()],
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			include: ["src/lib/**/*.ts", "src/server/**/*.ts"],
			exclude: [
				"src/**/__tests__/**",
				"src/**/*.test.ts",
				"src/lib/currencies.ts",
				"src/lib/supported-crypto-icons.ts",
				"src/lib/db-enums.ts",
			],
			thresholds: {
				lines: 20,
				functions: 20,
				branches: 20,
				statements: 20,
			},
		},
	},
});
