// Where the app under test runs. `pnpm dev:test` serves it on its own port
// (not 1998, the old default, nor the owner's 2997) against its own database
// on the e2e test Postgres (docker-compose.test.yml, 127.0.0.1:5437).
// There is deliberately no fallback to DATABASE_URL: global setup wipes the
// database (see fixtures/seed.ts).
export const E2E_PORT = 3106;
export const E2E_BASE_URL =
	process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL =
	process.env.E2E_DATABASE_URL ??
	"postgresql://postgres:testpassword@127.0.0.1:5437/retrospend_test_e2e";

export const E2E_AUTH_SECRET =
	process.env.E2E_AUTH_SECRET ?? "e2e-test-secret-value-32-chars-!!";

/**
 * E2E_SEALED=1 runs the whole suite with DATA_KEYS_WRITE on (E2EE D11 PR 9.2,
 * docs/roadmap/e2ee-d11-pr9.md section 6), so user text is sealed on write.
 * The key below is a throwaway for the e2e database only: it wraps keys that
 * the pre-server reset (reset-before-server.ts) deletes at the start of every
 * run. It protects nothing and must never be a real master key.
 */
export const E2E_SEALED = process.env.E2E_SEALED === "1";
export const E2E_MASTER_KEY =
	"e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0";

// Where global setup saves the ids it wrote (sealed runs, see sealing-seed.ts)
export const SEALING_SEED_IDS = "playwright/.sealing/seed-ids.json";

// Paths to saved auth state (reused across tests)
export const USER_STORAGE_STATE = "playwright/.auth/user.json";
export const ADMIN_STORAGE_STATE = "playwright/.auth/admin.json";

/**
 * A seeded persona's session, saved once per run by auth.setup.ts. The
 * server takes 10 sign-ins a minute from one client (better-auth config) and
 * every test comes from the same address, so specs reuse these sessions
 * instead of signing in again. A run signs in 9 times today (auth.setup.ts
 * and auth.spec.ts); a new spec that signs in pushes it toward the limit.
 */
export function personaStorageState(username: string): string {
	return `playwright/.auth/${username}.json`;
}

// Test user credentials, signed up by global-setup.ts
export const TEST_USER = {
	email: "e2e-test@retrospend.app",
	password: "TestPassword123!",
	name: "E2E Test User",
	username: "e2etest",
} as const;

export const ADMIN_USER = {
	email: "e2e-admin@retrospend.app",
	password: "AdminPassword123!",
	name: "E2E Admin User",
	username: "e2eadmin",
} as const;
