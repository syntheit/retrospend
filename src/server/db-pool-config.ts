import type { PoolConfig } from "pg";

/**
 * How long Postgres lets a connection sit inside an open transaction without
 * a statement before it ends that connection. A transaction left open
 * anywhere in the cluster holds back `pg_snapshot_xmin`, which stalls the
 * events feed and the sync cursor for every user. It is above the longest
 * interactive transaction the app opens (the 60 s import) and fires only
 * between statements, so a long statement is never cut.
 */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 120_000;

const SETTING = "idle_in_transaction_session_timeout";

/**
 * The URL with the timeout added to its own `options` parameter. pg merges
 * the parsed URL over the config, so an `options` in the URL (for example
 * `-c search_path=app`) would replace one set in the config: it has to be
 * merged here. An operator's own value for the setting is kept.
 */
function withTimeoutOption(connectionString: string, ms: number): string {
	// Only the query is rebuilt: the part before `?` (user, password, host)
	// is passed on exactly as given.
	const at = connectionString.indexOf("?");
	const base = at < 0 ? connectionString : connectionString.slice(0, at);
	const params = new URLSearchParams(
		at < 0 ? "" : connectionString.slice(at + 1),
	);
	const existing = params.get("options") ?? "";
	if (existing.includes(SETTING)) return connectionString;
	params.set("options", `${existing} -c ${SETTING}=${ms}`.trim());
	return `${base}?${params}`;
}

/**
 * The app's one pool: db-core.ts builds it from this, and the pg test setup
 * does too, so tests see the same connection settings as production. The
 * migration and bootstrap connections (scripts/db-owner) do not use it: they
 * are one-shot, and a migration may hold a transaction open between
 * statements for longer than this on a large table.
 */
export function appPoolConfig(
	connectionString: string,
	idleInTransactionMs: number = IDLE_IN_TRANSACTION_TIMEOUT_MS,
): PoolConfig {
	return {
		connectionString: withTimeoutOption(connectionString, idleInTransactionMs),
		max: 20,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 5000,
	};
}
