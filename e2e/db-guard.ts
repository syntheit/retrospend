/**
 * The e2e run wipes its database (fixtures/seed.ts) and `pnpm dev:test`
 * migrates it, so playwright.config.ts checks the URL before anything starts:
 * the local test Postgres (127.0.0.1, localhost or ::1, port 5436), a
 * database named retrospend_test_e2e*, and no ?host= override that would
 * point the connection somewhere else.
 *
 * Staging runs (IMPLEMENTATION §5 S6 milestone 4) reset their own database
 * on purpose and opt out with E2E_ALLOW_STAGING_DB=1. Nothing else should.
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const TEST_PORT = "5436";

/** Why `url` is not a safe e2e database, or null when it is. */
export function e2eDatabaseProblem(url: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "is not a URL";
	}
	if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "is not a Postgres URL";
	if (!LOCAL_HOSTS.has(parsed.hostname)) {
		return `host "${parsed.hostname}" is not 127.0.0.1, localhost or ::1`;
	}
	if (parsed.port !== TEST_PORT) {
		return `port "${parsed.port}" is not ${TEST_PORT} (the test Postgres)`;
	}
	const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
	if (!name.startsWith("retrospend_test_e2e")) {
		return `database "${name}" is not named retrospend_test_e2e*`;
	}
	if (parsed.searchParams.has("host")) {
		return "has a ?host= parameter, which overrides the host";
	}
	return null;
}

export function assertE2eDatabase(
	url: string,
	env: Record<string, string | undefined> = process.env,
): void {
	if (env.E2E_ALLOW_STAGING_DB === "1") return;
	const problem = e2eDatabaseProblem(url);
	if (problem) {
		throw new Error(
			`Refusing to run e2e: the database URL ${problem}. The run wipes it. ` +
				"Set E2E_DATABASE_URL to the local test database, or E2E_ALLOW_STAGING_DB=1 on staging.",
		);
	}
}
