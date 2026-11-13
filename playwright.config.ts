import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
	E2E_AUTH_SECRET,
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	E2E_MASTER_KEY,
	E2E_PORT,
	E2E_SEALED,
} from "./e2e/constants";
import { assertE2eDatabase } from "./e2e/db-guard";
import { SEED_TIME_ZONE } from "./e2e/fixtures/personas";

// Before anything starts: `pnpm dev:test` migrates this database and global
// setup wipes it.
assertE2eDatabase(E2E_DATABASE_URL);

// A sealed run needs the server this config starts, on a database it emptied
// first: a server already running may hold another key or another database.
if (
	E2E_SEALED &&
	(process.env.E2E_REUSE_SERVER === "1" || process.env.E2E_BASE_URL)
)
	throw new Error(
		"Refusing to run e2e: E2E_SEALED=1 cannot reuse a running server or use E2E_BASE_URL. " +
			"A sealed run starts its own server with the e2e master key. Unset E2E_REUSE_SERVER and E2E_BASE_URL.",
	);

const UPLOAD_DIR =
	process.env.E2E_UPLOAD_DIR ??
	mkdtempSync(join(tmpdir(), "retrospend-e2e-uploads-"));

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

// Visual regression (e2e/visual). Only defined when E2E_VISUAL=1, so the
// plain e2e run never compares screenshots taken by another renderer: the
// baselines come from the pinned Playwright image, which the browser joins
// through PW_TEST_CONNECT_WS_ENDPOINT. Run it with e2e/visual/run.sh.
const visual = {
	name: "visual",
	testDir: "./e2e/visual",
	testMatch: "**/*.spec.ts",
	// A retry would hide a screenshot that differs on one run in two.
	retries: 0,
	snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
	use: {
		...devices["Desktop Chrome"],
		locale: "en-US",
		timezoneId: SEED_TIME_ZONE,
		reducedMotion: "reduce" as const,
	},
	expect: {
		toHaveScreenshot: {
			animations: "disabled" as const,
			caret: "hide" as const,
			scale: "css" as const,
			stylePath: "./e2e/visual/screenshot.css",
		},
	},
};

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	retries: process.env.CI ? 1 : 0,
	// One worker. Every flow signs in to the same seeded ledger (Sofía, Martín
	// and Lucía share projects, payments and rates), so a spec that saves
	// changes the figures another spec is reading. The flows undo what they
	// save, but only after the save has landed. E2E_WORKERS raises it for a
	// run of specs that share nothing.
	workers: Number(process.env.E2E_WORKERS ?? 1),
	reporter: [["html", { open: "never" }], ["list"]],
	use: {
		baseURL: E2E_BASE_URL,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
	},
	projects: [
		// Logs in the blank test accounts and the personas and saves their sessions
		{
			name: "setup",
			testMatch: /auth\.setup\.ts/,
			use: chromium,
		},
		// Tests that need no pre-existing session
		{
			name: "auth-flows",
			use: chromium,
			dependencies: ["setup"],
			testMatch: ["**/auth.spec.ts", "**/smoke.spec.ts"],
		},
		// Persona flows on the seeded ledger (fixtures/seed.ts), and the blank
		// account and the guest flows
		{
			name: "flows",
			testDir: "./e2e/flows",
			testMatch: "**/*.spec.ts",
			use: chromium,
			dependencies: ["setup"],
		},
		...(process.env.E2E_VISUAL === "1" ? [visual] : []),
	],
	globalSetup: "./e2e/global-setup.ts",
	// An external E2E_BASE_URL means the app is already running elsewhere.
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				// The reset empties the database (both modes, see the file) before
				// the server migrates it and, sealed, writes its canary and keys.
				// The last -p wins, so this overrides dev:test's own port.
				command: `pnpm exec tsx e2e/reset-before-server.ts && pnpm dev:test -p ${E2E_PORT}`,
				url: E2E_BASE_URL,
				// Reusing a server on the port could mean testing another DB.
				reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
				timeout: 180_000,
				// Playwright started this process group and stops exactly it.
				gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
				env: {
					DATABASE_URL: E2E_DATABASE_URL,
					AUTH_SECRET: E2E_AUTH_SECRET,
					PUBLIC_URL: E2E_BASE_URL,
					NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
					UPLOAD_DIR,
					// No sidecar in e2e: rates come from the seed.
					SIDECAR_URL: "http://127.0.0.1:9",
					// E2E_SEALED=1: the server seals user text on write (e2e/constants.ts).
					...(E2E_SEALED
						? { DATA_KEYS_WRITE: "true", DATA_MASTER_KEY: E2E_MASTER_KEY }
						: {}),
				},
			},
});
