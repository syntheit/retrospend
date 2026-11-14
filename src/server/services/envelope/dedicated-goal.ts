/**
 * Savings goals linked to a Wealth account marked "Only for this goal"
 * (SPEC §5.4, B12, B13). What their progress is lives in
 * @retrospend/domain/envelope/dedicated-goal, shared with devices; here: the
 * read of the accounts they follow.
 */
import type { DedicatedAccount } from "@retrospend/domain/envelope/book-source";
import type { Prisma } from "~prisma";
import type { BookRow } from "./inputs";

export { dedicatedValues } from "@retrospend/domain/envelope/dedicated-goal";
export type { DedicatedAccount };

type Tx = Prisma.TransactionClient;

/** The accounts dedicated goals follow (no query when the book has none). */
export async function loadDedicatedAccounts(
	tx: Tx,
	row: BookRow,
): Promise<DedicatedAccount[]> {
	const ids = row.envelopes.flatMap((e) =>
		e.wealthDedicated && e.wealthAccountId && e.kind === "SAVINGS"
			? [e.wealthAccountId]
			: [],
	);
	if (ids.length === 0) return [];
	return tx.assetAccount.findMany({
		where: { id: { in: ids }, closedAt: null },
		select: {
			id: true,
			type: true,
			balance: true,
			currency: true,
			exchangeRateType: true,
		},
	});
}
