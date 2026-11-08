/**
 * Checks of TEST_DATABASE_URL for the pg test harness (pg-global-setup.ts). Pure:
 * pg-env.ts, the setup file of every worker, reads the databases the global
 * setup made when it is imported, so nothing else imports it.
 */

// A derived name is `<base>_<4 hex>` plus a suffix of at most 4 characters
// ("_tpl", "_w16"), and Postgres truncates identifiers at 63 bytes.
const MAX_BASE_NAME = 54;

// The harness creates and drops databases, so it must never reach a real one.
// Dev (5434) and staging (5435) databases listen on localhost too, and the app
// ports (prod 1997, dev 2997, staging 3997) are never a test Postgres.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REFUSED_PORTS = new Set([5434, 5435, 1997, 2997, 3997]);
const TEST_NAME = /^retrospend_test(_|$)/;

/**
 * Validates TEST_DATABASE_URL and returns the server URL and base database
 * name. Throws unless it points at a local test Postgres with a
 * `retrospend_test` name.
 */
export function parseTestDatabaseUrl(raw: string | undefined): {
	baseUrl: URL;
	baseName: string;
} {
	if (!raw) {
		throw new Error(
			"TEST_DATABASE_URL is not set. Start docker-compose.test.yml and point it at a database name unique to your worktree.",
		);
	}

	const baseUrl = new URL(raw);
	if (!LOCAL_HOSTS.has(baseUrl.hostname)) {
		throw new Error(
			`TEST_DATABASE_URL must point at localhost, got host "${baseUrl.hostname}"`,
		);
	}
	const port = Number(baseUrl.port || 5432);
	if (REFUSED_PORTS.has(port)) {
		throw new Error(
			`TEST_DATABASE_URL port ${port} belongs to a dev, staging or prod service, not the test Postgres`,
		);
	}

	const baseName = baseUrl.pathname.slice(1);
	if (
		!TEST_NAME.test(baseName) ||
		!/^[a-z0-9_]+$/.test(baseName) ||
		baseName.length > MAX_BASE_NAME
	) {
		throw new Error(
			`TEST_DATABASE_URL database name must start with retrospend_test, use lowercase [a-z0-9_] and be at most ${MAX_BASE_NAME} characters, got "${baseName}"`,
		);
	}
	return { baseUrl, baseName };
}
