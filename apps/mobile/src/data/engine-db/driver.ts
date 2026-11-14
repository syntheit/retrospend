// The small SQL surface the device engine's disk copy needs. The app runs it
// on expo-sqlite (expo-driver.ts); jest runs it on node:sqlite. Every call is
// synchronous: one write is one transaction, so nothing can interleave.

export type SqlValue = string | number | null;

export interface SqlDriver {
	exec(sql: string): void;
	run(sql: string, params?: readonly SqlValue[]): void;
	/** One prepared statement, run once per parameter list. */
	runMany(sql: string, paramLists: readonly (readonly SqlValue[])[]): void;
	all<T extends object>(sql: string, params?: readonly SqlValue[]): T[];
	/** What `fn` writes commits together or not at all; a throw rolls back and rethrows. */
	transaction<T>(fn: () => T): T;
	close(): void;
}

/**
 * What a failed statement says about the file. "full" and "corrupt" end
 * persistence for the session, "notadb" means a wrong key or a foreign file.
 */
export type FailureKind = "full" | "corrupt" | "notadb" | "other";

const PRIMARY_CODES: Readonly<Record<number, FailureKind>> = {
	13: "full",
	11: "corrupt",
	26: "notadb",
};

/**
 * Sorts a thrown error by SQLite result code when the driver gives one
 * (node:sqlite does) and by the library's own message otherwise (expo-sqlite
 * passes the message through). Returns only the kind, so nothing a statement
 * carried can reach a log.
 */
export function failureKind(error: unknown): FailureKind {
	if (typeof error !== "object" || error === null) return "other";
	const { errcode, message } = error as {
		errcode?: unknown;
		message?: unknown;
	};
	if (typeof errcode === "number") {
		const kind = PRIMARY_CODES[errcode & 0xff];
		if (kind) return kind;
	}
	const text = typeof message === "string" ? message.toLowerCase() : "";
	if (text.includes("disk is full") || text.includes("sqlite_full"))
		return "full";
	if (text.includes("malformed") || text.includes("sqlite_corrupt"))
		return "corrupt";
	if (
		text.includes("not a database") ||
		text.includes("sqlite_notadb") ||
		text.includes("encrypted or is not")
	)
		return "notadb";
	return "other";
}
