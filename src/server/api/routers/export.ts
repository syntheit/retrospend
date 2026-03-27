import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generateCsv } from "~/lib/csv";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ExportService } from "~/server/services/export.service";
import { generatePersonPdf, generateProjectPdf } from "~/server/services/pdf.service";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { db as globalDb } from "~/server/db";
import type { ParticipantType, PrismaClient } from "~prisma";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves display names for a list of participant refs in a single batch.
 * Returns a Map from "type:id" → name.
 */
async function resolveParticipantNames(
	db: PrismaClient,
	refs: Array<{ participantType: string; participantId: string }>,
): Promise<Map<string, string>> {
	const unique = new Map<
		string,
		{ participantType: string; participantId: string }
	>();
	for (const r of refs) {
		unique.set(`${r.participantType}:${r.participantId}`, r);
	}
	const uniqueArr = [...unique.values()];

	const DELETED_USER = "DELETED_USER";
	const DELETED_GUEST = "DELETED_GUEST";

	const userIds = uniqueArr
		.filter((r) => r.participantType === "user" && r.participantId !== DELETED_USER)
		.map((r) => r.participantId);
	const shadowIds = uniqueArr
		.filter((r) => r.participantType === "shadow")
		.map((r) => r.participantId);
	const guestIds = uniqueArr
		.filter((r) => r.participantType === "guest" && r.participantId !== DELETED_GUEST)
		.map((r) => r.participantId);

	const [users, shadows, guests] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: { id: true, name: true },
				})
			: [],
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds } },
					select: { id: true, name: true },
				})
			: [],
		guestIds.length > 0
			? db.guestSession.findMany({
					where: { id: { in: guestIds } },
					select: { id: true, name: true },
				})
			: [],
	]);

	const result = new Map<string, string>();
	result.set(`user:${DELETED_USER}`, "Deleted User");
	result.set(`guest:${DELETED_GUEST}`, "Deleted Guest");
	for (const u of users) result.set(`user:${u.id}`, u.name ?? "Unknown");
	for (const s of shadows) result.set(`shadow:${s.id}`, s.name ?? "Unknown");
	for (const g of guests) result.set(`guest:${g.id}`, g.name ?? "Unknown");
	return result;
}

function triggerDownload(csv: string, filename: string) {
	return { csv, filename };
}

/**
 * Returns a map of transactionId → edit count (number of EDITED audit entries).
 * IDs with no edits are absent from the map (default to 0 at call sites).
 */
async function fetchEditCounts(
	transactionIds: string[],
): Promise<Map<string, number>> {
	if (transactionIds.length === 0) return new Map();
	const entries = await globalDb.auditLogEntry.groupBy({
		by: ["targetId"],
		where: {
			targetId: { in: transactionIds },
			action: "EDITED",
			targetType: "SHARED_TRANSACTION",
		},
		_count: { _all: true },
	});
	return new Map(entries.map((e) => [e.targetId, e._count._all]));
}

function csvMeta(lines: string[]): string {
	return lines.join("\n") + "\n";
}

// Fetch transactions + FINALIZED settlements for a project/period.
// Replicates the logic from project.ts fetchProjectTransactionsAndSettlements.
async function fetchTxAndSettlements(
	db: PrismaClient,
	projectId: string,
	periodId?: string,
) {
	const transactions = await db.sharedTransaction.findMany({
		where: {
			projectId,
			...(periodId ? { billingPeriodId: periodId } : {}),
		},
		select: {
			currency: true,
			amount: true,
			paidByType: true,
			paidById: true,
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
				},
			},
		},
	});

	if (transactions.length === 0) return { transactions: [], settlements: [] };

	const participantSet = new Map<
		string,
		{ participantType: ParticipantType; participantId: string }
	>();
	for (const tx of transactions) {
		participantSet.set(`${tx.paidByType}:${tx.paidById}`, {
			participantType: tx.paidByType,
			participantId: tx.paidById,
		});
		for (const sp of tx.splitParticipants) {
			participantSet.set(`${sp.participantType}:${sp.participantId}`, {
				participantType: sp.participantType,
				participantId: sp.participantId,
			});
		}
	}
	const participants = [...participantSet.values()];

	if (participants.length < 2) return { transactions, settlements: [] };

	const settlements = await db.settlement.findMany({
		where: {
			status: "FINALIZED",
			AND: [
				{
					OR: participants.map((p) => ({
						fromParticipantType: p.participantType,
						fromParticipantId: p.participantId,
					})),
				},
				{
					OR: participants.map((p) => ({
						toParticipantType: p.participantType,
						toParticipantId: p.participantId,
					})),
				},
			],
		},
		select: {
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
			amount: true,
			currency: true,
		},
	});

	return { transactions, settlements };
}

function txStatus(
	isLocked: boolean,
	splitParticipants: Array<{ verificationStatus: string }>,
): string {
	if (isLocked) return "Settled";
	if (splitParticipants.some((sp) => sp.verificationStatus === "REJECTED"))
		return "Disputed";
	if (splitParticipants.every((sp) => sp.verificationStatus === "ACCEPTED"))
		return "Verified";
	return "Pending";
}

// ── schemas ───────────────────────────────────────────────────────────────────

const formatSchema = z.literal("csv");

const participantTypeSchema = z.enum(["user", "guest", "shadow"]);

// ── router ────────────────────────────────────────────────────────────────────

export const exportRouter = createTRPCRouter({
	allData: protectedProcedure.mutation(async ({ ctx }) => {
		const exportService = new ExportService(ctx.db);
		return await exportService.exportAllData(ctx.session.user.id);
	}),

	/**
	 * Export all shared transactions in a project (optionally scoped to a
	 * billing period) as a CSV file.
	 *
	 * Columns: Date, Description, Amount, Currency, Category, Paid By,
	 * Split Mode, Split Details, Status.
	 *
	 * Split Details uses approach (b): a single formatted string per row,
	 * e.g. "Alice: 30.00 USD; Bob: 30.00 USD".
	 */
	exportProjectExpenses: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
				format: formatSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"VIEWER",
			);

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: { name: true, primaryCurrency: true },
			});

			const transactions = await ctx.db.sharedTransaction.findMany({
				where: {
					projectId: input.projectId,
					...(input.periodId ? { billingPeriodId: input.periodId } : {}),
				},
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
				orderBy: { date: "desc" },
			});

			// Bulk-resolve all participant names
			const allRefs = transactions.flatMap((tx) => [
				{ participantType: tx.paidByType, participantId: tx.paidById },
				...tx.splitParticipants.map((sp) => ({
					participantType: sp.participantType,
					participantId: sp.participantId,
				})),
			]);
			const nameMap = await resolveParticipantNames(ctx.db, allRefs);
			const editCounts = await fetchEditCounts(transactions.map((tx) => tx.id));

			const headers = [
				"Date",
				"Description",
				"Amount",
				"Currency",
				"Category",
				"Paid By",
				"Split Mode",
				"Split Details",
				"Status",
				"Edits",
			];

			const rows = transactions.map((tx) => {
				const paidByName =
					nameMap.get(`${tx.paidByType}:${tx.paidById}`) ?? "Unknown";
				const splitDetails = tx.splitParticipants
					.map((sp) => {
						const name =
							nameMap.get(`${sp.participantType}:${sp.participantId}`) ??
							"Unknown";
						return `${name}: ${Number(sp.shareAmount).toFixed(2)} ${tx.currency}`;
					})
					.join("; ");

				return [
					tx.date,
					tx.description,
					Number(tx.amount),
					tx.currency,
					tx.category?.name ?? "",
					paidByName,
					tx.splitMode,
					splitDetails,
					txStatus(tx.isLocked, tx.splitParticipants),
					editCounts.get(tx.id) ?? 0,
				];
			});

			const periodNote = input.periodId ? " (period-filtered)" : "";
			const meta = csvMeta([
				"Generated by Retrospend",
				`Export Date: ${new Date().toISOString().slice(0, 10)}`,
				`Project: ${project.name}${periodNote}`,
				`Total Expenses: ${transactions.length}`,
				"",
			]);

			const csv = meta + generateCsv(headers, rows);
			const slug = project.name
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 40);
			const filename = `${slug}-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
			return triggerDownload(csv, filename);
		}),

	/**
	 * Export all shared transactions between the current user and a specific
	 * person as a CSV file.
	 *
	 * Columns: Date, Description, Total Amount, Currency, Category, Paid By,
	 * Your Share, Their Share, Project, Status.
	 */
	exportPersonHistory: protectedProcedure
		.input(
			z.object({
				participantType: participantTypeSchema,
				participantId: z.string().min(1),
				format: formatSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Verify relationship exists
			const count = await ctx.db.sharedTransaction.count({
				where: {
					AND: [
						{
							splitParticipants: {
								some: { participantType: "user", participantId: userId },
							},
						},
						{
							splitParticipants: {
								some: {
									participantType: input.participantType,
									participantId: input.participantId,
								},
							},
						},
					],
				},
			});

			if (count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No shared transactions found with this person",
				});
			}

			const transactions = await ctx.db.sharedTransaction.findMany({
				where: {
					AND: [
						{
							splitParticipants: {
								some: { participantType: "user", participantId: userId },
							},
						},
						{
							splitParticipants: {
								some: {
									participantType: input.participantType,
									participantId: input.participantId,
								},
							},
						},
					],
				},
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
				orderBy: { date: "desc" },
			});

			// Resolve names
			const payerRefs = transactions.map((tx) => ({
				participantType: tx.paidByType,
				participantId: tx.paidById,
			}));
			const nameMap = await resolveParticipantNames(ctx.db, [
				...payerRefs,
				{
					participantType: input.participantType,
					participantId: input.participantId,
				},
			]);

			// Resolve project names
			const projectIds = [
				...new Set(
					transactions
						.filter((t) => t.projectId)
						.map((t) => t.projectId as string),
				),
			];
			const projects =
				projectIds.length > 0
					? await ctx.db.project.findMany({
							where: { id: { in: projectIds } },
							select: { id: true, name: true },
						})
					: [];
			const projectMap = new Map(projects.map((p) => [p.id, p.name]));

			const theirName =
				nameMap.get(`${input.participantType}:${input.participantId}`) ??
				"Unknown";

			const editCountsPerson = await fetchEditCounts(transactions.map((tx) => tx.id));

			const headers = [
				"Date",
				"Description",
				"Total Amount",
				"Currency",
				"Category",
				"Paid By",
				"Your Share",
				"Their Share",
				"Project",
				"Status",
				"Edits",
			];

			const rows = transactions.map((tx) => {
				const myPart = tx.splitParticipants.find(
					(sp) => sp.participantType === "user" && sp.participantId === userId,
				);
				const theirPart = tx.splitParticipants.find(
					(sp) =>
						sp.participantType === input.participantType &&
						sp.participantId === input.participantId,
				);
				const paidByName =
					nameMap.get(`${tx.paidByType}:${tx.paidById}`) ?? "Unknown";
				const projectName = tx.projectId
					? (projectMap.get(tx.projectId) ?? "")
					: "";

				return [
					tx.date,
					tx.description,
					Number(tx.amount),
					tx.currency,
					tx.category?.name ?? "",
					paidByName,
					myPart ? Number(myPart.shareAmount) : 0,
					theirPart ? Number(theirPart.shareAmount) : 0,
					projectName,
					txStatus(tx.isLocked, tx.splitParticipants),
					editCountsPerson.get(tx.id) ?? 0,
				];
			});

			const meta = csvMeta([
				"Generated by Retrospend",
				`Export Date: ${new Date().toISOString().slice(0, 10)}`,
				`Transaction History with: ${theirName}`,
				`Total Transactions: ${transactions.length}`,
				"",
			]);

			const csv = meta + generateCsv(headers, rows);
			const slug = theirName
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 30);
			const filename = `history-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
			return triggerDownload(csv, filename);
		}),

	/**
	 * Export the settlement plan between the current user and a specific person
	 * as a CSV. Columns: Currency, Amount, Direction.
	 */
	exportPersonSettlementPlan: protectedProcedure
		.input(
			z.object({
				participantType: participantTypeSchema,
				participantId: z.string().min(1),
				format: formatSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			// Fetch all shared transactions between the two participants
			const transactions = await ctx.db.sharedTransaction.findMany({
				where: {
					AND: [
						{
							splitParticipants: {
								some: { participantType: "user", participantId: userId },
							},
						},
						{
							splitParticipants: {
								some: {
									participantType: input.participantType,
									participantId: input.participantId,
								},
							},
						},
					],
				},
				include: {
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
						},
					},
				},
			});

			if (transactions.length === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No shared transactions found with this person",
				});
			}

			// Compute net balance per currency
			const balanceMap = new Map<
				string,
				number
			>();
			for (const tx of transactions) {
				const myShare = tx.splitParticipants.find(
					(sp) => sp.participantType === "user" && sp.participantId === userId,
				);
				const iPaid =
					tx.paidByType === "user" && tx.paidById === userId
						? Number(tx.amount)
						: 0;
				const myOwed = myShare ? Number(myShare.shareAmount) : 0;
				// positive = they owe me, negative = I owe them
				const net = iPaid - myOwed;
				balanceMap.set(tx.currency, (balanceMap.get(tx.currency) ?? 0) + net);
			}

			// Also account for finalized settlements between the two
			const settlements = await ctx.db.settlement.findMany({
				where: {
					status: "FINALIZED",
					OR: [
						{
							fromParticipantType: "user",
							fromParticipantId: userId,
							toParticipantType: input.participantType,
							toParticipantId: input.participantId,
						},
						{
							fromParticipantType: input.participantType,
							fromParticipantId: input.participantId,
							toParticipantType: "user",
							toParticipantId: userId,
						},
					],
				},
				select: {
					fromParticipantType: true,
					fromParticipantId: true,
					amount: true,
					currency: true,
				},
			});

			for (const s of settlements) {
				const iSent =
					s.fromParticipantType === "user" && s.fromParticipantId === userId;
				// If I sent money, my balance goes down (they owe me less)
				// If they sent money, my balance goes up (they owe me more / I owe less)
				const adj = iSent ? -Number(s.amount) : Number(s.amount);
				balanceMap.set(s.currency, (balanceMap.get(s.currency) ?? 0) + adj);
			}

			const nameMap = await resolveParticipantNames(ctx.db, [
				{ participantType: input.participantType, participantId: input.participantId },
			]);
			const theirName =
				nameMap.get(`${input.participantType}:${input.participantId}`) ?? "Unknown";

			const headers = ["Currency", "Amount", "Direction"];
			const rows: unknown[][] = [];
			for (const [currency, balance] of balanceMap.entries()) {
				if (Math.abs(balance) < 0.005) continue;
				rows.push([
					currency,
					Math.abs(balance).toFixed(2),
					balance > 0
						? `${theirName} owes you`
						: `You owe ${theirName}`,
				]);
			}

			const meta = csvMeta([
				"Generated by Retrospend",
				`Export Date: ${new Date().toISOString().slice(0, 10)}`,
				`Settlement Plan with: ${theirName}`,
				"",
			]);

			const csv =
				meta +
				(rows.length > 0
					? generateCsv(headers, rows)
					: "Currency,Amount,Direction\n(All settled up)\n");

			const slug = theirName
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 30);
			const filename = `settlement-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
			return triggerDownload(csv, filename);
		}),

	/**
	 * Export a PDF summary of the relationship between the current user and
	 * a specific person.
	 */
	exportPersonPdf: protectedProcedure
		.input(
			z.object({
				participantType: participantTypeSchema,
				participantId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;

			const transactions = await ctx.db.sharedTransaction.findMany({
				where: {
					AND: [
						{
							splitParticipants: {
								some: { participantType: "user", participantId: userId },
							},
						},
						{
							splitParticipants: {
								some: {
									participantType: input.participantType,
									participantId: input.participantId,
								},
							},
						},
					],
				},
				include: {
					category: { select: { name: true } },
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
						},
					},
				},
				orderBy: { date: "desc" },
			});

			if (transactions.length === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No shared transactions found with this person",
				});
			}

			// Resolve names
			const payerRefs = transactions.map((tx) => ({
				participantType: tx.paidByType,
				participantId: tx.paidById,
			}));
			const nameMap = await resolveParticipantNames(ctx.db, [
				...payerRefs,
				{
					participantType: input.participantType,
					participantId: input.participantId,
				},
			]);

			const theirName =
				nameMap.get(`${input.participantType}:${input.participantId}`) ?? "Unknown";

			// Resolve project names
			const projectIds = [
				...new Set(
					transactions
						.filter((t) => t.projectId)
						.map((t) => t.projectId as string),
				),
			];
			const projects =
				projectIds.length > 0
					? await ctx.db.project.findMany({
							where: { id: { in: projectIds } },
							select: { id: true, name: true },
						})
					: [];
			const projectMap = new Map(projects.map((p) => [p.id, p.name]));

			// Compute balances per currency (same logic as settlement plan)
			const balanceMap = new Map<string, number>();
			for (const tx of transactions) {
				const myShare = tx.splitParticipants.find(
					(sp) => sp.participantType === "user" && sp.participantId === userId,
				);
				const iPaid =
					tx.paidByType === "user" && tx.paidById === userId
						? Number(tx.amount)
						: 0;
				const myOwed = myShare ? Number(myShare.shareAmount) : 0;
				const net = iPaid - myOwed;
				balanceMap.set(tx.currency, (balanceMap.get(tx.currency) ?? 0) + net);
			}

			// Account for finalized settlements
			const settlements = await ctx.db.settlement.findMany({
				where: {
					status: "FINALIZED",
					OR: [
						{
							fromParticipantType: "user",
							fromParticipantId: userId,
							toParticipantType: input.participantType,
							toParticipantId: input.participantId,
						},
						{
							fromParticipantType: input.participantType,
							fromParticipantId: input.participantId,
							toParticipantType: "user",
							toParticipantId: userId,
						},
					],
				},
				select: {
					fromParticipantType: true,
					fromParticipantId: true,
					amount: true,
					currency: true,
				},
			});

			for (const s of settlements) {
				const iSent =
					s.fromParticipantType === "user" && s.fromParticipantId === userId;
				const adj = iSent ? -Number(s.amount) : Number(s.amount);
				balanceMap.set(s.currency, (balanceMap.get(s.currency) ?? 0) + adj);
			}

			const balances = [...balanceMap.entries()]
				.filter(([, amount]) => Math.abs(amount) >= 0.005 || balanceMap.size === 1)
				.map(([currency, amount]) => ({
					currency,
					amount,
					direction:
						Math.abs(amount) < 0.005
							? ("settled" as const)
							: amount > 0
								? ("they_owe_you" as const)
								: ("you_owe_them" as const),
				}));

			// Project breakdown
			const projCountMap = new Map<string | null, number>();
			for (const tx of transactions) {
				const key = tx.projectId;
				projCountMap.set(key, (projCountMap.get(key) ?? 0) + 1);
			}
			const projectBreakdown = [...projCountMap.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([projId, count]) => ({
					projectName: projId ? (projectMap.get(projId) ?? "Unknown") : null,
					transactionCount: count,
				}));

			// Category breakdown
			const catMap = new Map<string, { count: number; total: number; currency: string }>();
			for (const tx of transactions) {
				const cat = tx.category?.name ?? "Uncategorized";
				const existing = catMap.get(cat) ?? { count: 0, total: 0, currency: tx.currency };
				existing.count += 1;
				existing.total += Number(tx.amount);
				catMap.set(cat, existing);
			}
			const categoryBreakdown = [...catMap.entries()]
				.sort((a, b) => b[1].total - a[1].total)
				.map(([category, data]) => ({
					category,
					count: data.count,
					total: data.total,
					currency: data.currency,
				}));

			// Relationship stats
			const firstDate = transactions.length > 0
				? transactions[transactions.length - 1]!.date
				: null;

			const pdfBuffer = await generatePersonPdf({
				personName: theirName,
				participantType: input.participantType,
				balances,
				relationshipStats: {
					transactionCount: transactions.length,
					projectCount: projectIds.length,
					firstTransactionDate: firstDate
						? (firstDate instanceof Date
								? firstDate.toISOString().slice(0, 10)
								: String(firstDate))
						: null,
				},
				projectBreakdown,
				categoryBreakdown,
				expenses: transactions.map((tx) => {
					const myPart = tx.splitParticipants.find(
						(sp) =>
							sp.participantType === "user" && sp.participantId === userId,
					);
					const theirPart = tx.splitParticipants.find(
						(sp) =>
							sp.participantType === input.participantType &&
							sp.participantId === input.participantId,
					);
					return {
						date:
							tx.date instanceof Date
								? tx.date.toISOString().slice(0, 10)
								: String(tx.date),
						description: tx.description,
						amount: Number(tx.amount),
						currency: tx.currency,
						category: tx.category?.name ?? "",
						paidBy:
							nameMap.get(`${tx.paidByType}:${tx.paidById}`) ?? "Unknown",
						yourShare: myPart ? Number(myPart.shareAmount) : 0,
						theirShare: theirPart ? Number(theirPart.shareAmount) : 0,
						project: tx.projectId
							? (projectMap.get(tx.projectId) ?? "")
							: "",
					};
				}),
			});

			const slug = theirName
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 30);
			const filename = `${slug}-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
			return { pdf: pdfBuffer.toString("base64"), filename };
		}),

	/**
	 * Export a billing period summary as a CSV.
	 *
	 * The file has two sections:
	 *   1. EXPENSES: one row per shared transaction.
	 *   2. SETTLEMENT PLAN: the minimum payments to zero out the period.
	 */
	exportBillingPeriodSummary: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().min(1),
				format: formatSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"VIEWER",
			);

			const [project, period] = await Promise.all([
				ctx.db.project.findUniqueOrThrow({
					where: { id: input.projectId },
					select: { name: true, primaryCurrency: true },
				}),
				ctx.db.billingPeriod.findUnique({
					where: { id: input.periodId },
					include: {
						sharedTransactions: {
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
							orderBy: { date: "desc" },
						},
					},
				}),
			]);

			if (!period || period.projectId !== input.projectId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Billing period not found",
				});
			}

			// Bulk-resolve all participant names
			const allRefs = period.sharedTransactions.flatMap((tx) => [
				{ participantType: tx.paidByType, participantId: tx.paidById },
				...tx.splitParticipants.map((sp) => ({
					participantType: sp.participantType,
					participantId: sp.participantId,
				})),
			]);
			const nameMap = await resolveParticipantNames(ctx.db, allRefs);

			// Compute settlement plan for this period
			const { transactions: txsForPlan, settlements } =
				await fetchTxAndSettlements(ctx.db, input.projectId, input.periodId);
			const plan = computeSettlementPlan(txsForPlan, settlements);

			const totalSpent = period.sharedTransactions.reduce(
				(sum, tx) => sum + Number(tx.amount),
				0,
			);
			const dateRange = `${period.startDate.toISOString().slice(0, 10)} to ${period.endDate.toISOString().slice(0, 10)}`;

			const meta = csvMeta([
				"Generated by Retrospend",
				`Export Date: ${new Date().toISOString().slice(0, 10)}`,
				`Project: ${project.name}`,
				`Period: ${period.label}`,
				`Date Range: ${dateRange}`,
				`Total Spent: ${totalSpent.toFixed(2)} ${project.primaryCurrency}`,
				"",
			]);

			// Expenses section
			const editCountsPeriod = await fetchEditCounts(
				period.sharedTransactions.map((tx) => tx.id),
			);

			const expenseHeaders = [
				"Date",
				"Description",
				"Amount",
				"Currency",
				"Category",
				"Paid By",
				"Split Details",
				"Status",
				"Edits",
			];
			const expenseRows = period.sharedTransactions.map((tx) => {
				const paidByName =
					nameMap.get(`${tx.paidByType}:${tx.paidById}`) ?? "Unknown";
				const splitDetails = tx.splitParticipants
					.map((sp) => {
						const name =
							nameMap.get(`${sp.participantType}:${sp.participantId}`) ??
							"Unknown";
						return `${name}: ${Number(sp.shareAmount).toFixed(2)}`;
					})
					.join("; ");
				return [
					tx.date,
					tx.description,
					Number(tx.amount),
					tx.currency,
					tx.category?.name ?? "",
					paidByName,
					splitDetails,
					txStatus(tx.isLocked, tx.splitParticipants),
					editCountsPeriod.get(tx.id) ?? 0,
				];
			});

			// Settlement plan section
			const settlementHeaders = ["From", "To", "Amount", "Currency"];
			const settlementRows: unknown[][] = [];
			for (const [currency, breakdown] of Object.entries(plan.byCurrency)) {
				for (const step of breakdown.plan) {
					const fromName =
						nameMap.get(
							`${step.from.participantType}:${step.from.participantId}`,
						) ?? "Unknown";
					const toName =
						nameMap.get(
							`${step.to.participantType}:${step.to.participantId}`,
						) ?? "Unknown";
					settlementRows.push([fromName, toName, step.amount, currency]);
				}
			}

			const csv =
				meta +
				"EXPENSES\n" +
				generateCsv(expenseHeaders, expenseRows) +
				"\n\nSETTLEMENT PLAN\n" +
				(settlementRows.length > 0
					? generateCsv(settlementHeaders, settlementRows)
					: "From,To,Amount,Currency\n(No settlements required)\n");

			const slug = project.name
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 30);
			const periodSlug = period.label
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 25);
			const filename = `${slug}-${periodSlug}-${new Date().toISOString().slice(0, 10)}.csv`;
			return triggerDownload(csv, filename);
		}),

	/**
	 * Export the settlement plan for a project (or billing period) as a CSV.
	 *
	 * Columns: From, To, Amount, Currency.
	 */
	exportSettlementPlan: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
				format: formatSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"VIEWER",
			);

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: { name: true },
			});

			const { transactions, settlements } = await fetchTxAndSettlements(
				ctx.db,
				input.projectId,
				input.periodId,
			);

			const plan = computeSettlementPlan(transactions, settlements);

			// Collect all participant refs from the plan result
			const allRefs: Array<{
				participantType: string;
				participantId: string;
			}> = [];
			for (const breakdown of Object.values(plan.byCurrency)) {
				for (const step of breakdown.plan) {
					allRefs.push(step.from, step.to);
				}
			}
			const nameMap = await resolveParticipantNames(ctx.db, allRefs);

			const headers = ["From", "To", "Amount", "Currency"];
			const rows: unknown[][] = [];
			for (const [currency, breakdown] of Object.entries(plan.byCurrency)) {
				for (const step of breakdown.plan) {
					const fromName =
						nameMap.get(
							`${step.from.participantType}:${step.from.participantId}`,
						) ?? "Unknown";
					const toName =
						nameMap.get(
							`${step.to.participantType}:${step.to.participantId}`,
						) ?? "Unknown";
					rows.push([fromName, toName, step.amount, currency]);
				}
			}

			const periodNote = input.periodId ? " (period-scoped)" : "";
			const meta = csvMeta([
				"Generated by Retrospend",
				`Export Date: ${new Date().toISOString().slice(0, 10)}`,
				`Project: ${project.name}${periodNote}`,
				"",
			]);

			const csv =
				meta +
				(rows.length > 0
					? generateCsv(headers, rows)
					: "From,To,Amount,Currency\n(No settlements required)\n");

			const slug = project.name
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 40);
			const filename = `${slug}-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
			return triggerDownload(csv, filename);
		}),

	/**
	 * Export a full project summary as a PDF document.
	 */
	exportProjectPdf: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const userId = ctx.session.user.id;
			await requireProjectRole(
				ctx.db,
				input.projectId,
				"user",
				userId,
				"VIEWER",
			);

			const project = await ctx.db.project.findUniqueOrThrow({
				where: { id: input.projectId },
				select: {
					name: true,
					description: true,
					type: true,
					status: true,
					primaryCurrency: true,
					startDate: true,
					endDate: true,
					budgetAmount: true,
					budgetCurrency: true,
				},
			});

			// Resolve period label if scoped
			let periodLabel: string | null = null;
			if (input.periodId) {
				const period = await ctx.db.billingPeriod.findUnique({
					where: { id: input.periodId },
					select: { label: true },
				});
				periodLabel = period?.label ?? null;
			}

			// Fetch participants
			const rawParticipants = await ctx.db.projectParticipant.findMany({
				where: { projectId: input.projectId },
				select: {
					participantType: true,
					participantId: true,
					role: true,
				},
			});

			const participantNameMap = await resolveParticipantNames(
				ctx.db,
				rawParticipants.map((p) => ({
					participantType: p.participantType,
					participantId: p.participantId,
				})),
			);

			const participants = rawParticipants.map((p) => ({
				name:
					participantNameMap.get(
						`${p.participantType}:${p.participantId}`,
					) ?? "Unknown",
				role: p.role,
			}));

			// Fetch transactions
			const transactions = await ctx.db.sharedTransaction.findMany({
				where: {
					projectId: input.projectId,
					...(input.periodId ? { billingPeriodId: input.periodId } : {}),
				},
				include: {
					category: { select: { name: true } },
					splitParticipants: {
						select: {
							participantType: true,
							participantId: true,
							shareAmount: true,
						},
					},
				},
				orderBy: { date: "desc" },
			});

			// Resolve payer names
			const payerRefs = transactions.map((tx) => ({
				participantType: tx.paidByType,
				participantId: tx.paidById,
			}));
			const payerNameMap = await resolveParticipantNames(ctx.db, payerRefs);

			// Category breakdown
			const catMap = new Map<
				string,
				{ count: number; total: number }
			>();
			for (const tx of transactions) {
				const cat = tx.category?.name ?? "Uncategorized";
				const existing = catMap.get(cat) ?? { count: 0, total: 0 };
				existing.count += 1;
				existing.total += Number(tx.amount);
				catMap.set(cat, existing);
			}
			const categoryBreakdown = [...catMap.entries()]
				.sort((a, b) => b[1].total - a[1].total)
				.map(([category, data]) => ({
					category,
					count: data.count,
					total: data.total,
				}));

			const totalSpent = transactions.reduce(
				(sum, tx) => sum + Number(tx.amount),
				0,
			);

			const isSolo = project.type === "SOLO";

			// Compute balances and settlement plan (non-SOLO only)
			let balances: Array<{
				name: string;
				paid: number;
				fairShare: number;
				net: number;
			}> = [];
			let settlements: Array<{
				from: string;
				to: string;
				amount: number;
				currency: string;
			}> = [];

			if (!isSolo) {
				const { transactions: txsForPlan, settlements: existingSettlements } =
					await fetchTxAndSettlements(
						ctx.db,
						input.projectId,
						input.periodId,
					);
				const plan = computeSettlementPlan(txsForPlan, existingSettlements);

				// Flatten balances across currencies
				const balanceMap = new Map<
					string,
					{ paid: number; fairShare: number; net: number }
				>();
				for (const breakdown of Object.values(plan.byCurrency)) {
					for (const b of breakdown.balances) {
						const key = `${b.participant.participantType}:${b.participant.participantId}`;
						const existing = balanceMap.get(key) ?? {
							paid: 0,
							fairShare: 0,
							net: 0,
						};
						existing.paid += b.totalPaid;
						existing.fairShare += b.fairShare;
						existing.net += b.netBalance;
						balanceMap.set(key, existing);
					}
				}
				balances = [...balanceMap.entries()].map(([key, data]) => ({
					name: participantNameMap.get(key) ?? "Unknown",
					paid: data.paid,
					fairShare: data.fairShare,
					net: data.net,
				}));

				// Settlement steps
				const allSettlementRefs: Array<{
					participantType: string;
					participantId: string;
				}> = [];
				for (const breakdown of Object.values(plan.byCurrency)) {
					for (const step of breakdown.plan) {
						allSettlementRefs.push(step.from, step.to);
					}
				}
				const settlementNameMap = await resolveParticipantNames(
					ctx.db,
					allSettlementRefs,
				);

				for (const [currency, breakdown] of Object.entries(plan.byCurrency)) {
					for (const step of breakdown.plan) {
						settlements.push({
							from:
								settlementNameMap.get(
									`${step.from.participantType}:${step.from.participantId}`,
								) ?? "Unknown",
							to:
								settlementNameMap.get(
									`${step.to.participantType}:${step.to.participantId}`,
								) ?? "Unknown",
							amount: step.amount,
							currency,
						});
					}
				}
			}

			const pdfBuffer = await generateProjectPdf({
				projectName: project.name,
				projectType: project.type,
				status: project.status,
				startDate: project.startDate
					? project.startDate.toISOString().slice(0, 10)
					: null,
				endDate: project.endDate
					? project.endDate.toISOString().slice(0, 10)
					: null,
				primaryCurrency: project.primaryCurrency,
				description: project.description,
				periodLabel,
				participants,
				totalSpent,
				expenseCount: transactions.length,
				budgetAmount: project.budgetAmount
					? Number(project.budgetAmount)
					: null,
				categoryBreakdown,
				balances,
				settlements,
				expenses: transactions.map((tx) => ({
					date:
						tx.date instanceof Date
							? tx.date.toISOString().slice(0, 10)
							: String(tx.date),
					description: tx.description,
					amount: Number(tx.amount),
					currency: tx.currency,
					category: tx.category?.name ?? "",
					paidBy:
						payerNameMap.get(`${tx.paidByType}:${tx.paidById}`) ?? "Unknown",
				})),
			});

			const slug = project.name
				.replace(/[^a-z0-9]/gi, "-")
				.toLowerCase()
				.slice(0, 40);
			const filename = `${slug}-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
			return { pdf: pdfBuffer.toString("base64"), filename };
		}),
});
