/**
 * Postgres errors that mean "another transaction got there first", read the
 * one way everywhere. Codes only: messages change with the driver.
 */

/** Serialization failure (REPEATABLE READ met a row committed after its snapshot) and deadlock. */
const SERIALIZATION_SQLSTATES = new Set(["40001", "40P01"]);

/**
 * The SQLSTATE of a query Postgres cancelled. @prisma/adapter-pg carries it
 * at `meta.driverAdapterError.cause.code`, whatever Prisma code wraps it (a
 * raw query arrives as P2010).
 */
export function sqlstateOf(error: unknown): string | undefined {
	const e = error as {
		meta?: { driverAdapterError?: { cause?: { code?: string } } };
	} | null;
	return e?.meta?.driverAdapterError?.cause?.code;
}

/**
 * A write or lock that lost to a concurrent transaction and may succeed when
 * run again from the start: Postgres' 40001 and 40P01, or P2034, Prisma's own
 * name for a write conflict.
 */
export function isSerializationFailure(error: unknown): boolean {
	// A figure or an extension may wrap what the driver threw.
	for (let e = error, depth = 0; e && depth < 8; depth++) {
		if ((e as { code?: string }).code === "P2034") return true;
		if (SERIALIZATION_SQLSTATES.has(sqlstateOf(e) ?? "")) return true;
		e = (e as { cause?: unknown }).cause;
	}
	return false;
}
