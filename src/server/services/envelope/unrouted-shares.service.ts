/**
 * Shares with no envelope (SPEC §5.8, §5.14 "Shares need an envelope"): your
 * shares of someone else's splits that found no category of yours (D19), so
 * they sit in "Everything else" until you pick one. Ids only, no titles: the
 * client joins the expense. Picking is `setShareCategory`, which previews.
 */
import type {
	UnroutedSharesInput,
	UnroutedSharesOutput,
} from "~/lib/schemas/envelope-crud";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { MonthRead } from "./month-read";
import { closedView, movedFirst } from "./read.service";

export function unroutedIn(
	view: MonthRead,
	input: UnroutedSharesInput,
): UnroutedSharesOutput {
	const { loaded } = view;
	const H = loaded.book.currency;
	// The engine's entry for a share is its value in the book currency; none means a missing rate.
	const value = new Map(
		loaded.input.activity
			.filter((a) => a.source === "SHARE")
			.map((a) => [a.id, -a.minor]),
	);
	const shares = loaded.splits.shares
		.filter((s) => loaded.splits.unresolved.has(s.id))
		.map((s) => {
			const minor = value.get(s.id);
			const date = loaded.valuer.dated(s.transaction.date);
			return {
				shareId: s.id,
				expenseId: s.transaction.id,
				date: date.date,
				month: date.month,
				amount: minor === undefined ? null : { minor, currency: H },
				projectId: s.transaction.projectId,
				payer: {
					type: s.transaction.paidByType,
					id: s.transaction.paidById,
				},
			};
		})
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	return {
		defaultEnvelopeId: view.dto.book.defaultEnvelopeId,
		shares: shares.slice(0, input.limit),
		total: {
			minor: shares.reduce((t, s) => t + (s.amount?.minor ?? 0), 0),
			currency: H,
		},
		count: shares.length,
		incomplete: shares.some((s) => s.amount === null),
	};
}

/** Null without a budget ("Just track"). */
export function getUnroutedShares(
	userId: string,
	input: UnroutedSharesInput,
	now = new Date(),
): Promise<UnroutedSharesOutput | null> {
	return movedFirst(userId, now, null, () =>
		userTransaction(db, userId, async (tx) => {
			const view = await closedView(tx, userId, now);
			return view ? unroutedIn(view, input) : null;
		}),
	);
}
