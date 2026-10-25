/**
 * envelope.setup as a money mutation (R30): the first-run write. Its preview
 * is the same write rolled back, so the setup sheet shows exactly what
 * starting the budget will hold, open balances with people included. Undo
 * deletes the book (cascade) and the starting balance row.
 */
import type { SetupInput, SetupResult } from "~/lib/schemas/envelope";
import type { MoneyMutation } from "../preview/types";
import { setupBook } from "./book.service";
import { loadBook } from "./inputs";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { planCostIn } from "./plan-read";
import { replaySplits } from "./splits-replay";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

export type SetupMutationInput = SetupInput & { timeZone: string | null };

export const setupEnvelopeBook: MoneyMutation<SetupMutationInput, SetupResult> =
	{
		id: "envelope.setup",
		touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
		run: async (tx, { timeZone, ...input }, actor) => {
			const now = new Date();
			const made = await setupBook(tx, actor.userId, input, { now, timeZone });
			return {
				value: {
					bookId: made.bookId,
					openBalances: await openBalancesAtStart(tx, actor.userId, now),
					plan: await planAtStart(tx, actor.userId, now),
				},
				undo: {
					kind: "revert",
					mutation: "envelope.setup",
					rows: [
						{ table: "budget_book", id: made.bookId },
						...(made.startingBalanceExpenseId
							? [{ table: "expense", id: made.startingBalanceExpenseId }]
							: []),
					],
				},
			};
		},
	};

/**
 * What the new plan costs a month against what the book starts with, so the
 * setup can stop when the plan costs more than there is. A style that funds
 * itself (Limits) has no money to compare with.
 */
async function planAtStart(
	tx: Parameters<typeof loadBook>[0],
	userId: string,
	now: Date,
): Promise<SetupResult["plan"]> {
	forgetMonthViews(tx);
	const read = await monthViewIn(tx, userId, now);
	if (!read || read.dto.book.fundingSource === "TARGETS") return null;
	const cost = (await planCostIn(tx, userId, {}, now)).cost;
	const available = read.dto.toAssign.amount;
	return {
		cost,
		available,
		short: {
			minor: Math.max(0, cost.minor - available.minor),
			currency: cost.currency,
		},
	};
}

/** Balances with each person from before the start, per currency, never netted. */
async function openBalancesAtStart(
	tx: Parameters<typeof loadBook>[0],
	userId: string,
	now: Date,
): Promise<SetupResult["openBalances"]> {
	forgetMonthViews(tx);
	const loaded = await loadBook(tx, userId, { now });
	if (!loaded) return [];
	const start = loaded.input.startMonth;
	return replaySplits(loaded.splits.events.filter((e) => e.month < start))
		.balances.filter((b) => b.native !== 0)
		.map((b) => {
			const at = b.counterparty.indexOf(":");
			return {
				participant: {
					type: b.counterparty.slice(0, at) as "user" | "guest" | "shadow",
					id: b.counterparty.slice(at + 1),
				},
				amount: { minor: b.native, currency: b.currency },
			};
		});
}
