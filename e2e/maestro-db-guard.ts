/**
 * The Maestro seed CLI (fixtures/seed-maestro.ts) wipes the database it is
 * given. The web guard (db-guard.ts) only knows the Playwright database, so
 * the mobile runs have their own: a loopback host, a database named
 * rs_e2e_*, and no ?host= override. The port is free because every runner
 * slot has a Postgres of its own (maestro-plan.md 1.3).
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PREFIX = "rs_e2e_";

/** Why `url` is not a safe Maestro database, or null when it is. */
export function maestroDatabaseProblem(url: string): string | null {
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
	const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
	if (!name.startsWith(PREFIX)) {
		return `database "${name}" is not named ${PREFIX}*`;
	}
	if (parsed.searchParams.has("host")) {
		return "has a ?host= parameter, which overrides the host";
	}
	return null;
}

export function assertMaestroDatabase(url: string): void {
	const problem = maestroDatabaseProblem(url);
	if (problem) {
		throw new Error(
			`Refusing to seed: the database URL ${problem}. The seed wipes it.`,
		);
	}
}
