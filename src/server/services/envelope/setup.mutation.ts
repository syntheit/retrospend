/**
 * envelope.setup as a money mutation (R30): the first-run write. Its preview
 * is the same write rolled back, so the setup sheet shows exactly what
 * starting the budget will hold, open balances with people included. The
 * result carries the signed token envelope.undoSetup takes the budget back
 * with (setup-undo.service.ts).
 */
import {
	AMOUNT_SETUP_STYLES,
	type SetupInput,
	type SetupResult,
} from "~/lib/schemas/envelope";
import type { MoneyMutation } from "../preview/types";
import { setupBook } from "./book.service";
import { projectIn, savePayoffPlan } from "./debt.service";
import { EnvelopeError } from "./errors";
import { loadBook } from "./inputs";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { nextPay } from "./pay-cycle";
import { planCostIn } from "./plan-read";
import { setupFootprint, signSetupUndo } from "./setup-undo.service";
import { replaySplits } from "./splits-replay";
import { applyPlan } from "./use-my-plan";
import { FIGURE_LEFT_TO_SPEND, FIGURE_NOT_PLANNED_YET } from "./verdict";

export type SetupMutationInput = SetupInput & { timeZone: string | null };

export const setupEnvelopeBook: MoneyMutation<SetupMutationInput, SetupResult> =
	{
		id: "envelope.setup",
		touches: [FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
		run: async (tx, { timeZone, ...input }, actor) => {
			const now = new Date();
			const made = await setupBook(tx, actor.userId, input, { now, timeZone });
			// Before the plan's cost is read: the extra is the Extra debt payment's target.
			const payoff = await savePayoffAtSetup(
				tx,
				actor.userId,
				input,
				made,
				now,
			);
			const plan = await planAtStart(tx, actor.userId, now);
			await fundAmounts(tx, actor.userId, input, now);
			const openBalances = await openBalancesAtStart(tx, actor.userId, now);
			return {
				value: {
					bookId: made.bookId,
					openBalances,
					plan,
					nextPay: nextPay(
						input.pay?.frequency ?? null,
						input.pay?.nextPay ?? null,
						made.today,
					),
					payoff,
					// Last, so the footprint holds everything this write made.
					restore: signSetupUndo(
						actor.userId,
						await setupFootprint(tx, actor.userId, made.bookId),
					),
				},
				undo: {
					kind: "revert",
					mutation: "envelope.undoSetup",
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
 * Pay off debt: the payoff plan is saved in the same write as the book (the
 * extra lands on the new Extra debt payment envelope) and the result says
 * where it leads, from the projection the plan screen reads.
 */
async function savePayoffAtSetup(
	tx: Parameters<typeof loadBook>[0],
	userId: string,
	input: SetupInput,
	made: { envelopeIds: ReadonlyMap<string, string> },
	now: Date,
): Promise<SetupResult["payoff"]> {
	const plan = input.payoff;
	if (!plan) return null;
	const envelopeId = made.envelopeIds.get(plan.envelopeKey);
	if (!envelopeId)
		throw new EnvelopeError(
			"INVALID",
			"the payoff plan names an unknown envelope",
		);
	await savePayoffPlan(tx, userId, {
		strategy: plan.strategy,
		extraMonthlyMinor: plan.extraMonthlyMinor,
		customOrder: [],
		envelopeId,
	});
	const p = await projectIn(tx, userId, {}, now);
	return {
		debtFreeMonth: p.debtFreeMonth,
		totalInterest: p.totalInterest,
		diverges: p.diverges,
		incomplete: p.incomplete,
		debts: p.debts.length,
	};
}

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

/**
 * The amounts set here are what the budget starts with: the book is funded
 * from the money to plan as Use my plan does (the rest stays Not planned
 * yet), in the same write, so the preview shows the funded result and the
 * first expense is not overspent. Undo goes with the book (cascade).
 */
async function fundAmounts(
	tx: Parameters<typeof loadBook>[0],
	userId: string,
	input: SetupInput,
	now: Date,
): Promise<void> {
	if (!AMOUNT_SETUP_STYLES.has(input.style)) return;
	forgetMonthViews(tx);
	const read = await monthViewIn(tx, userId, now);
	const held = Math.max(0, read?.dto.toAssign.amount.minor ?? 0);
	if (held > 0)
		await applyPlan(tx, userId, now, { amount: held, rest: "LEAVE" });
	forgetMonthViews(tx);
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
