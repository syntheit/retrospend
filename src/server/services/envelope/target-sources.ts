/**
 * What envelope targets follow outside the book (02 §3.5): recurring
 * templates a bill follows (D26) and liabilities whose minimum and due day a
 * bill follows (SPEC §5.4, §5.11). Read only when an envelope names one, so
 * a book without such bills costs no query.
 */
import type { Prisma, RecurringTemplate } from "~prisma";
import { addMonthsToDate } from "./calendar";
import type { BookRow } from "./inputs";
import type { IsoDate, Minor } from "./types";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

/** A liability's terms as a bill target reads them. */
export interface LiabilityTerms {
	id: string;
	currency: string;
	minimumPayment: Prisma.Decimal | null;
	/** Day of the month; null without a due day. */
	dueDate: number | null;
	/** Payments to it since last month began: principal plus interest, by day (own minor units). */
	payments?: Array<{ date: IsoDate; minor: Minor }>;
}

export async function loadTargetSources(
	tx: Tx,
	row: BookRow,
	today: IsoDate,
): Promise<{
	templates: RecurringTemplate[];
	liabilities: LiabilityTerms[];
}> {
	const templateIds = row.envelopes.flatMap((e) =>
		e.targetTemplateId ? [e.targetTemplateId] : [],
	);
	const liabilityIds = row.envelopes.flatMap((e) =>
		e.targetLiabilityId ? [e.targetLiabilityId] : [],
	);
	const templates = templateIds.length
		? await tx.recurringTemplate.findMany({
				where: { id: { in: templateIds } },
			})
		: [];
	const liabilities = liabilityIds.length
		? await tx.assetAccount.findMany({
				where: { id: { in: liabilityIds } },
				select: {
					id: true,
					currency: true,
					minimumPayment: true,
					dueDate: true,
				},
			})
		: [];
	if (liabilities.length === 0) return { templates, liabilities: [] };
	// From the first of last month: enough to see this cycle, whatever the due day.
	const since = new Date(
		`${addMonthsToDate(today.slice(0, 8) + "01", -1)}T00:00:00Z`,
	);
	const paid = await tx.transfer.findMany({
		where: { toAccountId: { in: liabilityIds }, date: { gte: since } },
		select: {
			toAccountId: true,
			toAmount: true,
			date: true,
			feeExpense: { select: { amount: true } },
		},
	});
	return {
		templates,
		liabilities: liabilities.map((l) => ({
			...l,
			payments: paid
				.filter((p) => p.toAccountId === l.id)
				.map((p) => ({
					date: p.date.toISOString().slice(0, 10),
					minor:
						toMinor(p.toAmount, l.currency) +
						(p.feeExpense ? toMinor(p.feeExpense.amount, l.currency) : 0),
				})),
		})),
	};
}
