/** The person summary PDF: reads the shared history, formats every amount, hands the text to the renderer. */
import { shareCounts } from "@retrospend/domain/share-status";
import { dayKey } from "@retrospend/domain/time-zone";
import { amountText } from "./amounts";
import { categoryRows } from "./categories";
import { type ExportContext, isoDay, type PdfDocument, slug } from "./context";
import { nameOf, resolveParticipantNames } from "./names";
import {
	balanceText,
	noSharedExpenses,
	type PersonRef,
	pairBalances,
	sharedWith,
} from "./person";
import { generatePersonPdf } from "./person-pdf-render";

export async function exportPersonPdf(
	ctx: ExportContext,
	them: PersonRef,
): Promise<PdfDocument> {
	const transactions = await ctx.db.sharedTransaction.findMany({
		where: await sharedWith(ctx.db, them),
		include: {
			category: { select: { name: true } },
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
					verificationStatus: true,
				},
			},
		},
		orderBy: [{ date: "desc" }, { id: "asc" }],
	});
	if (transactions.length === 0) throw noSharedExpenses();

	const names = await resolveParticipantNames(ctx.db, [
		...transactions.map((tx) => ({
			participantType: tx.paidByType,
			participantId: tx.paidById,
		})),
		them,
	]);
	const theirName = nameOf(names, them);
	const projectIds = [
		...new Set(transactions.flatMap((t) => (t.projectId ? [t.projectId] : []))),
	];
	const projects =
		projectIds.length > 0
			? await ctx.db.project.findMany({
					where: { id: { in: projectIds } },
					select: { id: true, name: true },
				})
			: [];
	const projectName = new Map(projects.map((p) => [p.id, p.name]));

	const balances = await pairBalances(
		ctx.db,
		ctx.userId,
		them,
		transactions.map((tx) => tx.currency),
	);

	const perProject = new Map<string | null, number>();
	for (const tx of transactions) {
		perProject.set(tx.projectId, (perProject.get(tx.projectId) ?? 0) + 1);
	}
	const oldest = transactions[transactions.length - 1]?.date;

	const pdf = await generatePersonPdf({
		timeZone: ctx.timeZone,
		personName: theirName,
		participantType: them.participantType,
		balances: balances.map((b) => ({
			currency: b.currency,
			amount: balanceText(b),
			direction: b.direction,
		})),
		relationshipStats: {
			transactionCount: transactions.length,
			projectCount: projectIds.length,
			firstTransactionDate: oldest ? isoDay(oldest, ctx.timeZone) : null,
		},
		projectBreakdown: [...perProject]
			.sort((a, b) => b[1] - a[1])
			.map(([projectId, count]) => ({
				projectName: projectId
					? (projectName.get(projectId) ?? "Unknown")
					: null,
				transactionCount: count,
			})),
		categoryBreakdown: categoryRows(transactions),
		expenses: transactions.map((tx) => {
			// A share the signed-in person cannot see reads empty, not 0. A
			// rejected share is not owed: 0, and the row is labeled Disputed, so
			// the shares add up to the balance this file reports.
			const shareOf = (sp: PersonRef) => {
				const row = tx.splitParticipants.find(
					(s) =>
						s.participantType === sp.participantType &&
						s.participantId === sp.participantId,
				);
				if (!row) return "";
				return amountText(
					shareCounts(row.verificationStatus) ? row.shareAmount : "0",
					tx.currency,
				);
			};
			const disputed = tx.splitParticipants.some(
				(s) => !shareCounts(s.verificationStatus),
			);
			return {
				date: isoDay(tx.date, ctx.timeZone),
				description: disputed
					? `${tx.description} (Disputed)`
					: tx.description,
				amount: amountText(tx.amount, tx.currency),
				currency: tx.currency,
				category: tx.category?.name ?? "",
				paidBy: nameOf(names, {
					participantType: tx.paidByType,
					participantId: tx.paidById,
				}),
				yourShare: shareOf({
					participantType: "user",
					participantId: ctx.userId,
				}),
				theirShare: shareOf(them),
				project: tx.projectId ? (projectName.get(tx.projectId) ?? "") : "",
			};
		}),
	});

	return {
		pdf,
		filename: `${slug(theirName, 30)}-summary-${dayKey(new Date(), ctx.timeZone)}.pdf`,
	};
}
