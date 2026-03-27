import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

// Test server runs on a different port to avoid conflicts with dev server
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:1998";

// Test database — set E2E_DATABASE_URL to use docker-compose.test.yml isolation.
// Falls back to DATABASE_URL (dev DB) so tests work out of the box.
const DB_URL =
	process.env.E2E_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:testpassword@localhost:5433/retrospend_test";

const UPLOAD_DIR =
	process.env.E2E_UPLOAD_DIR ??
	mkdtempSync(join(tmpdir(), "retrospend-e2e-uploads-"));

const AUTH_SECRET =
	process.env.AUTH_SECRET ??
	process.env.E2E_AUTH_SECRET ??
	"e2e-test-secret-value-32-chars-!!";

export const USER_STORAGE_STATE = "playwright/.auth/user.json";
export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	retries: process.env.CI ? 1 : 0,
	reporter: [["html", { open: "never" }], ["list"]],
	use: {
		baseURL: BASE_URL,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	projects: [
		// Setup project: logs in and saves auth state
		{
			name: "setup",
			testMatch: /auth\.setup\.ts/,
		},
		// Main project: authenticated tests
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				storageState: USER_STORAGE_STATE,
			},
			dependencies: ["setup"],
			testIgnore: ["**/auth.spec.ts", "**/smoke.spec.ts"],
		},
		// Auth/smoke project: tests that need no pre-existing session
		{
			name: "auth-flows",
			use: devices["Desktop Chrome"],
			dependencies: ["setup"],
			testMatch: ["**/auth.spec.ts", "**/smoke.spec.ts"],
		},
	],
	globalSetup: "./e2e/global-setup.ts",
	webServer: {
		command: "pnpm dev:test",
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			DATABASE_URL: DB_URL,
			AUTH_SECRET: AUTH_SECRET,
			PUBLIC_URL: BASE_URL,
			NEXT_PUBLIC_APP_URL: BASE_URL,
			UPLOAD_DIR,
		},
	},
});
