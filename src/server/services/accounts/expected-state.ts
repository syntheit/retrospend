/**
 * The one compare of an account write with the state its caller read (M6,
 * slice-device-wealth.md Revision 2 item 3 and Revision 3 item 5). A write that
 * names `expectedVersion` runs only while the account still has that version
 * (the trigger of 20261127100000_account_version moves it); Update balance
 * also names `expectedBalance`, the stored balance it saw. Both are read in the
 * write's own transaction on the locked row, so a second writer holding the
 * same state waits for the first to commit, then reads what it left and is
 * refused. A preview skips the lock: it writes nothing.
 */
import { inPreview } from "~/server/db-tx";
import { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;

export interface ExpectedAccountState {
	/** The `version` the caller read. */
	readonly expectedVersion?: number;
	/** The stored balance the caller read, decimal text; compared as a number. */
	readonly expectedBalance?: string;
}

/**
 * Throws `stale()` unless the account still has the named version and balance.
 * Nothing named, or an account that is not there, passes: the mutation's own
 * not-found answer stands.
 */
export async function requireAccountState(
	tx: Tx,
	userId: string,
	id: string,
	expected: ExpectedAccountState,
	stale: () => Error,
): Promise<void> {
	const { expectedVersion, expectedBalance } = expected;
	if (expectedVersion === undefined && expectedBalance === undefined) return;
	// "balance" = text::numeric is a number compare: "1000" equals 1000.00000000.
	const rows = await tx.$queryRaw<
		{ version: number; balanceMatches: boolean | null }[]
	>`
		SELECT "version",
		       ${expectedBalance === undefined ? Prisma.sql`NULL::boolean` : Prisma.sql`"balance" = ${expectedBalance}::numeric`} AS "balanceMatches"
		FROM "asset_account"
		WHERE "id" = ${id} AND "userId" = ${userId}
		${inPreview() ? Prisma.empty : Prisma.sql`FOR UPDATE`}`;
	const row = rows[0];
	if (!row) return;
	if (expectedVersion !== undefined && row.version !== expectedVersion)
		throw stale();
	if (expectedBalance !== undefined && row.balanceMatches !== true)
		throw stale();
}

/** The account's version now, for the answer of a write. */
export async function accountVersionIn(
	tx: Tx,
	userId: string,
	id: string,
): Promise<number> {
	const row = await tx.assetAccount.findFirstOrThrow({
		where: { id, userId },
		select: { version: true },
	});
	return row.version;
}
