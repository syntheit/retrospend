/**
 * Savings goals linked to a Wealth account marked "Only for this goal"
 * (SPEC §5.4, B12, B13): their progress is the envelope's Left plus that
 * account's value today in the book currency, instead of Left plus what was
 * moved to Wealth. Display and target sizing only, like a foreign target
 * (D25). An account in another currency without a rate today leaves the
 * target incomplete, never valued at 1 (R14).
 */
import type { Prisma } from "~prisma";
import { worthOf } from "../accounts/places";
import type { BookRow } from "./inputs";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import { type ValuationContext, convertToBook } from "./valuation";

type Tx = Prisma.TransactionClient;

export type DedicatedAccount = Awaited<
	ReturnType<typeof loadDedicatedAccounts>
>[number];

/** The accounts dedicated goals follow (no query when the book has none). */
export async function loadDedicatedAccounts(tx: Tx, row: BookRow) {
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

/** Each dedicated goal's account value today in H; null and a missing rate when it has none. */
export function dedicatedValues(
	row: BookRow,
	accounts: readonly DedicatedAccount[],
	at: { today: IsoDate; month: MonthKey; valuation: ValuationContext },
	missingRates: MissingRate[],
): Map<string, Minor | null> {
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const out = new Map<string, Minor | null>();
	for (const e of row.envelopes) {
		const a =
			e.wealthDedicated && e.wealthAccountId
				? byId.get(e.wealthAccountId)
				: null;
		if (!a || e.kind !== "SAVINGS") continue;
		const v = convertToBook(
			worthOf(a.type, a.balance).toString(),
			a.currency,
			{
				date: at.today,
				month: at.month,
				foreignRateType: a.exchangeRateType ?? "official",
			},
			at.valuation,
		);
		if (!v.ok) missingRates.push(v.missing);
		out.set(e.id, v.ok ? v.minor : null);
	}
	return out;
}
