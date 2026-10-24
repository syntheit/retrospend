/**
 * What envelope targets follow outside the book (02 §3.5): recurring
 * templates a bill follows (D26) and liabilities whose minimum and due day a
 * bill follows (SPEC §5.4, §5.11). Read only when an envelope names one, so
 * a book without such bills costs no query.
 */
import type { Prisma, RecurringTemplate } from "~prisma";
import type { BookRow } from "./inputs";

type Tx = Prisma.TransactionClient;

/** A liability's terms as a bill target reads them. */
export interface LiabilityTerms {
	id: string;
	currency: string;
	minimumPayment: Prisma.Decimal | null;
	/** Day of the month; null without a due day. */
	dueDate: number | null;
}

export async function loadTargetSources(
	tx: Tx,
	row: BookRow,
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
		? await tx.recurringTemplate.findMany({ where: { id: { in: templateIds } } })
		: [];
	const liabilities = liabilityIds.length
		? await tx.assetAccount.findMany({
				where: { id: { in: liabilityIds } },
				select: { id: true, currency: true, minimumPayment: true, dueDate: true },
			})
		: [];
	return { templates, liabilities };
}
