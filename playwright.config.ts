import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	E2E_PORT,
	USER_STORAGE_STATE,
} from "./e2e/constants";
import { assertE2eDatabase } from "./e2e/db-guard";
import { SEED_TIME_ZONE } from "./e2e/fixtures/personas";

// Before anything starts: `pnpm dev:test` migrates this database and global
// setup wipes it.
assertE2eDatabase(E2E_DATABASE_URL);

const UPLOAD_DIR =
	process.env.E2E_UPLOAD_DIR ??
	mkdtempSync(join(tmpdir(), "retrospend-e2e-uploads-"));

const AUTH_SECRET =
	process.env.E2E_AUTH_SECRET ?? "e2e-test-secret-value-32-chars-!!";

// NixOS cannot run Playwright's downloaded browsers; point this at a Nix
// Chrome or Chromium instead (docs/ui-overhaul/ops/e2e.sh does).
const executablePath = process.env.E2E_CHROMIUM_PATH;

const chromium = {
	...devices["Desktop Chrome"],
	locale: "en-US",
	timezoneId: SEED_TIME_ZONE,
	launchOptions: executablePath
		? { executablePath, args: ["--no-sandbox"] }
		: {},
};

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	retries: process.env.CI ? 1 : 0,
	reporter: [["html", { open: "never" }], ["list"]],
	use: {
		baseURL: E2E_BASE_URL,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	// uiV2Mode is one app-wide row, so the run has two phases: every project
	// up to "flows" sees the old pages (the seed leaves the flag OFF), then
	// "ui-v2-on" turns it on for "flows-v2" alone and its teardown turns it
	// off. Nothing else runs while the flag is on.
	projects: [
		// Logs in the blank test accounts and the personas and saves their sessions
		{
			name: "setup",
			testMatch: /auth\.setup\.ts/,
			use: chromium,
		},
		// Older specs, signed in as the blank test user
		{
			name: "chromium",
			use: { ...chromium, storageState: USER_STORAGE_STATE },
			dependencies: ["setup"],
			testMatch: /e2e\/[^/]+\.spec\.ts$/,
			testIgnore: ["**/auth.spec.ts", "**/smoke.spec.ts"],
		},
		// Tests that need no pre-existing session
		{
			name: "auth-flows",
			use: chromium,
			dependencies: ["setup"],
			testMatch: ["**/auth.spec.ts", "**/smoke.spec.ts"],
		},
		// Persona flows on the seeded ledger (fixtures/seed.ts), on the old pages
		{
			name: "flows",
			testDir: "./e2e/flows",
			testMatch: "**/*.spec.ts",
			testIgnore: "**/v2/**",
			use: chromium,
			dependencies: ["setup"],
		},
		// Runs once the old-page projects are done (see above)
		{
			name: "ui-v2-on",
			testMatch: /ui-v2-on\.setup\.ts/,
			use: chromium,
			dependencies: ["chromium", "auth-flows", "flows"],
			teardown: "ui-v2-off",
		},
		{
			name: "ui-v2-off",
			testMatch: /ui-v2-off\.teardown\.ts/,
			use: chromium,
		},
		// Persona flows on the redesigned pages, with uiV2 on for everyone
		{
			name: "flows-v2",
			testDir: "./e2e/flows/v2",
			testMatch: "**/*.spec.ts",
			use: chromium,
			dependencies: ["ui-v2-on"],
		},
	],
	globalSetup: "./e2e/global-setup.ts",
	// An external E2E_BASE_URL means the app is already running elsewhere.
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				// The last -p wins, so this overrides dev:test's own port.
				command: `pnpm dev:test -p ${E2E_PORT}`,
				url: E2E_BASE_URL,
				// Reusing a server on the port could mean testing another DB.
				reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
				timeout: 180_000,
				// Playwright started this process group and stops exactly it.
				gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
				env: {
					DATABASE_URL: E2E_DATABASE_URL,
					AUTH_SECRET,
					PUBLIC_URL: E2E_BASE_URL,
					NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
					UPLOAD_DIR,
					// No sidecar in e2e: rates come from the seed.
					SIDECAR_URL: "http://127.0.0.1:9",
				},
			},
});
