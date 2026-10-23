/**
 * income.delete, the undo of income.add: the Money in row and its leg go,
 * and the account moves back. A template made with it goes too when named.
 * Its own undo is income.add with `recreate` (the same id).
 */
import { TRPCError } from "@trpc/server";
import { dec } from "~/server/services/envelope/units";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";
import { rowDayOf } from "../accounts/dates";
import { type AccountChange, reverseLegs } from "../accounts/ledger";
import { forgetMonthViews } from "../envelope/month-read";
import {
	FIGURE_LEFT_TO_SPEND,
	FIGURE_NOT_PLANNED_YET,
} from "../envelope/verdict";
import { type AddIncomeInput, INCOME_FIGURES } from "./add.mutation";
import { undoPlan } from "./plan-seam";

type Tx = Prisma.TransactionClient;

export interface DeleteIncomeInput {
	readonly expenseId: string;
	/** The template income.add created with it (Repeats), removed with it. */
	readonly templateId?: string | null;
	readonly timeZone?: string;
}

export interface DeletedIncome {
	readonly expenseId: string;
	readonly accounts: readonly AccountChange[];
	readonly recreate: AddIncomeInput;
}

/**
 * The leg's units still counted on its account: counted units that moved on
 * with a transfer are counted where they went, so an undo never counts them
 * here again.
 */
function stillCounted(leg: {
	countedUnits: { toString(): string };
	account: { countedUnits: { toString(): string } } | null;
}) {
	const own = dec(leg.countedUnits.toString());
	const held = dec(leg.account?.countedUnits.toString() ?? "0");
	return own.lt(held) ? own : held;
}

/** A Money in row of the user's, of kind Income; throws otherwise. */
export async function incomeRow(tx: Tx, userId: string, expenseId: string) {
	const row = await tx.expense.findFirst({
		where: { id: expenseId, userId, direction: "IN", inType: "INCOME" },
		include: {
			accountLegs: {
				where: { source: "INCOME" },
				select: {
					accountId: true,
					date: true,
					amount: true,
					homeAmount: true,
					homeCurrency: true,
					countedUnits: true,
					account: { select: { countedUnits: true } },
				},
				take: 1,
			},
		},
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Income not found" });
	}
	return row;
}

export async function deleteIncomeIn(
	tx: Tx,
	userId: string,
	input: DeleteIncomeInput,
): Promise<DeletedIncome> {
	const row = await incomeRow(tx, userId, input.expenseId);
	if (row.movedInAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"This income was moved into your budget. Undo the Move in first.",
		});
	}
	const template =
		input.templateId && input.templateId === row.recurringTemplateId
			? await tx.recurringTemplate.findFirst({
					where: { id: input.templateId, userId },
				})
			: null;
	const leg = row.accountLegs[0];
	const recreate: AddIncomeInput = {
		id: row.id,
		title: row.title,
		amount: row.amount.toString(),
		currency: row.currency,
		rateType: row.pricingSource === "MANUAL" ? null : row.pricingSource,
		categoryId: row.categoryId,
		description: row.description,
		// The leg keeps the ledger's UTC-midnight day; a row without one is read in the zone.
		date: leg
			? leg.date.toISOString().slice(0, 10)
			: rowDayOf(row.date, input.timeZone),
		into: leg?.accountId ?? null,
		keep: row.keepInWealth,
		restore: {
			exchangeRate: row.exchangeRate.toString(),
			amountInUSD: row.amountInUSD.toString(),
			rateType: row.rateType,
			homeRate: row.homeRate?.toString() ?? null,
			units: leg ? leg.amount.toString() : null,
			// The row's booked home leg; rows from before it was booked keep the leg's.
			homeAmount:
				row.homeAmount?.toString() ?? leg?.homeAmount?.toString() ?? null,
			homeCurrency: row.homeCurrency ?? leg?.homeCurrency ?? null,
			countedUnits: leg ? stillCounted(leg).toString() : null,
		},
		repeats: template
			? {
					frequency: template.frequency,
					next: template.nextDueDate.toISOString().slice(0, 10),
				}
			: null,
	};
	// Use my plan's batch goes back first; the undo plans again only if asked.
	if (row.planBatchId) await undoPlan(tx, userId, row.planBatchId);
	const accounts = await reverseLegs(tx, { expenseId: row.id });
	await tx.expense.delete({ where: { id: row.id } });
	forgetMonthViews(tx);
	if (template)
		await tx.recurringTemplate.delete({ where: { id: template.id } });
	return { expenseId: row.id, accounts, recreate };
}

export const deleteIncome: MoneyMutation<DeleteIncomeInput, DeletedIncome> = {
	id: "income.delete",
	touches: [...INCOME_FIGURES, FIGURE_NOT_PLANNED_YET, FIGURE_LEFT_TO_SPEND],
	run: async (tx, input, actor) => {
		const value = await deleteIncomeIn(tx, actor.userId, input);
		return {
			value,
			undo: {
				kind: "revert",
				mutation: "income.add",
				rows: [{ table: "expense", id: value.expenseId }],
			},
		};
	},
};
