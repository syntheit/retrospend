/**
 * Postgres errors that mean "another transaction got there first", read the
 * one way everywhere. Codes only: messages change with the driver.
 */

/** Serialization failure (REPEATABLE READ met a row committed after its snapshot) and deadlock. */
const SERIALIZATION_SQLSTATES = new Set(["40001", "40P01"]);

interface DriverCause {
	kind?: string;
	code?: string;
	originalCode?: string;
}

const driverCause = (error: unknown): DriverCause | undefined =>
	(
		error as {
			meta?: { driverAdapterError?: { cause?: DriverCause } };
		} | null
	)?.meta?.driverAdapterError?.cause;

/**
 * The SQLSTATE of a query Postgres cancelled, from what @prisma/adapter-pg
 * carries at `meta.driverAdapterError.cause`: `originalCode` when the adapter
 * gave the error a kind of its own (40001 and 40P01 arrive as
 * `TransactionWriteConflict`), else `code`. Prisma wraps a raw query's failure
 * as P2010, so this is the only place the code is. The one reader: keystore
 * errors use it too.
 */
export function sqlstateOf(error: unknown): string | undefined {
	const cause = driverCause(error);
	return cause?.originalCode ?? cause?.code;
}

/**
 * A write or lock that lost to a concurrent transaction and may succeed when
 * run again from the start: Postgres' 40001 and 40P01, the adapter's
 * `TransactionWriteConflict` kind, or P2034, Prisma's own name for a write
 * conflict.
 */
export function isSerializationFailure(error: unknown): boolean {
	// A figure or an extension may wrap what the driver threw.
	for (let e = error, depth = 0; e && depth < 8; depth++) {
		if ((e as { code?: string }).code === "P2034") return true;
		if (driverCause(e)?.kind === "TransactionWriteConflict") return true;
		if (SERIALIZATION_SQLSTATES.has(sqlstateOf(e) ?? "")) return true;
		e = (e as { cause?: unknown }).cause;
	}
	return false;
}
