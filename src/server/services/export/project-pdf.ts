/** The project summary PDF: reads the project, formats every amount, hands the text to the renderer. */
import { dayKey } from "@retrospend/domain/time-zone";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { amountText, minorText, totalsText } from "./amounts";
import { categoryRows } from "./categories";
import { type ExportContext, isoDay, type PdfDocument, slug } from "./context";
import { nameOf, resolveParticipantNames } from "./names";
import { projectNumbers } from "./project-csv";
import { generateProjectPdf, type ProjectPdfData } from "./project-pdf-render";

export async function exportProjectPdf(
	ctx: ExportContext,
	input: { projectId: string; periodId?: string },
): Promise<PdfDocument> {
	await requireProjectRole(
		ctx.db,
		input.projectId,
		"user",
		ctx.userId,
		"VIEWER",
	);
	const project = await ctx.db.project.findUniqueOrThrow({
		where: { id: input.projectId },
		select: {
			name: true,
			description: true,
			status: true,
			primaryCurrency: true,
			budgetAmount: true,
			budgetCurrency: true,
		},
	});
	const period = input.periodId
		? await ctx.db.billingPeriod.findUnique({
				where: { id: input.periodId },
				select: { label: true },
			})
		: null;
	const rawParticipants = await ctx.db.projectParticipant.findMany({
		where: { projectId: input.projectId },
		select: { participantType: true, participantId: true, role: true },
	});
	const transactions = await ctx.db.sharedTransaction.findMany({
		where: {
			projectId: input.projectId,
			...(input.periodId ? { billingPeriodId: input.periodId } : {}),
		},
		include: { category: { select: { name: true } } },
		orderBy: [{ date: "desc" }, { id: "asc" }],
	});
	const isSolo = rawParticipants.length <= 1;
	const numbers = isSolo
		? null
		: await projectNumbers(ctx.db, input.projectId, input.periodId);

	const names = await resolveParticipantNames(ctx.db, [
		...rawParticipants,
		...transactions.map((tx) => ({
			participantType: tx.paidByType,
			participantId: tx.paidById,
		})),
		...(numbers?.members.map((m) => m.ref) ?? []),
		...(numbers?.transfers.flatMap((t) => [t.from, t.to]) ?? []),
	]);

	const budgetCurrency = project.budgetCurrency ?? project.primaryCurrency;
	const data: ProjectPdfData = {
		timeZone: ctx.timeZone,
		projectName: project.name,
		status: project.status,
		primaryCurrency: project.primaryCurrency,
		description: project.description,
		periodLabel: period?.label ?? null,
		participants: rawParticipants.map((p) => ({
			name: nameOf(names, p),
			role: p.role,
		})),
		totals: totalsText(transactions, project.primaryCurrency),
		expenseCount: transactions.length,
		budget: project.budgetAmount
			? `${amountText(project.budgetAmount, budgetCurrency)} ${budgetCurrency}`
			: null,
		categoryBreakdown: categoryRows(transactions),
		balances: (numbers?.members ?? []).flatMap((m) =>
			m.lines.map((line) => ({
				name: nameOf(names, m.ref),
				currency: line.currency,
				paid: minorText(line.paid, line.currency),
				fairShare: minorText(line.share, line.currency),
				net:
					(line.balance >= 0 ? "+" : "") +
					minorText(line.balance, line.currency),
			})),
		),
		settlements: (numbers?.transfers ?? []).map((t) => ({
			from: nameOf(names, t.from),
			to: nameOf(names, t.to),
			amount: minorText(t.amount.minor, t.amount.currency),
			currency: t.amount.currency,
		})),
		expenses: transactions.map((tx) => ({
			date: isoDay(tx.date),
			description: tx.description,
			amount: amountText(tx.amount, tx.currency),
			currency: tx.currency,
			category: tx.category?.name ?? "",
			paidBy: nameOf(names, {
				participantType: tx.paidByType,
				participantId: tx.paidById,
			}),
		})),
	};

	return {
		pdf: await generateProjectPdf(data),
		filename: `${slug(project.name, 40)}-summary-${dayKey(new Date(), ctx.timeZone)}.pdf`,
	};
}
