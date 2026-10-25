/**
 * The project page (uiV2) for a signed-in member: the header facts, the
 * hero figures, the members with your balance with each, spending by
 * category, the payments and the expense rows, all in minor units. The
 * Summary tab's group table and who pays whom come from getProjectSummary
 * (summary.service.ts); this read never recomputes them. Callers check that
 * the user is a member first.
 */
import { getImageUrl } from "~/lib/image-url";
import { dayKey } from "~/lib/time-zone";
import type { Money } from "~/server/figures/registry";
import { toMinor } from "~/server/services/envelope/units";
import { categoryTone } from "~/server/services/expense-list/category-tone";
import { BALANCE_SETTLEMENT_STATUSES } from "~/server/services/shared-expenses/balance";
import { computeBalanceBatch } from "~/server/services/shared-expenses/balance-batch";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { PrismaClient } from "~prisma";
import { batchResolveIdentities, type Identity } from "./identities";
import { membershipOf } from "./membership";
import { readProjectNumbers } from "./numbers";
import { budgetOf, byCategory, linesOf } from "./page-figures";
import { refKey } from "./summary";

/** The most expense rows the page loads at once; the count says when there are more. */
export const PAGE_ROWS = 500;

type Ref = { participantType: string; participantId: string };

const day = (d: Date) => d.toISOString().slice(0, 10);

function loadProject(db: PrismaClient, projectId: string) {
	return db.project.findUniqueOrThrow({
		where: { id: projectId },
		include: {
			participants: { orderBy: { joinedAt: "asc" } },
			billingPeriods: { orderBy: { startDate: "desc" } },
		},
	});
}

/** Every expense: the category lines need all of them; the rows show the newest PAGE_ROWS. */
function loadExpenses(db: PrismaClient, projectId: string) {
	return db.sharedTransaction.findMany({
		where: { projectId },
		orderBy: [{ date: "desc" }, { createdAt: "desc" }],
		select: {
			id: true,
			description: true,
			amount: true,
			currency: true,
			date: true,
			isLocked: true,
			paidByType: true,
			paidById: true,
			createdByType: true,
			createdById: true,
			category: {
				select: { id: true, name: true, icon: true, color: true },
			},
			splitParticipants: {
				select: {
					participantType: true,
					participantId: true,
					shareAmount: true,
					verificationStatus: true,
				},
			},
		},
	});
}

type Expense = Awaited<ReturnType<typeof loadExpenses>>[number];

function loadPayments(db: PrismaClient, projectId: string) {
	return db.settlement.findMany({
		where: {
			projectId,
			isOffset: false,
			status: { in: [...BALANCE_SETTLEMENT_STATUSES, "PROPOSED"] },
		},
		orderBy: { initiatedAt: "desc" },
		select: {
			id: true,
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
			amount: true,
			currency: true,
			status: true,
			initiatedAt: true,
			payment: { select: { paidOn: true } },
		},
	});
}

function person(key: string, people: Map<string, Identity>) {
	const who = people.get(key);
	return {
		id: key,
		name: who?.name ?? "Unknown",
		imageUrl: who?.avatarUrl ?? null,
	};
}

/** One expense as the rows show it: your share in its currency, the people, the state. */
function expenseRow(
	e: Expense,
	isMe: (r: Ref) => boolean,
	people: Map<string, Identity>,
) {
	const mine = e.splitParticipants.find(isMe);
	const payer = { participantType: e.paidByType, participantId: e.paidById };
	const payerKey = refKey(payer);
	const waiting =
		mine?.verificationStatus === "PENDING"
			? ("review" as const)
			: mine?.verificationStatus === "REJECTED"
				? ("rejected" as const)
				: null;
	return {
		id: e.id,
		title: e.description,
		date: day(e.date),
		category: e.category
			? { ...e.category, tone: categoryTone(e.category.color) }
			: null,
		amount: {
			minor: toMinor(e.amount.toString(), e.currency),
			currency: e.currency,
		},
		share: mine
			? {
					minor: toMinor(mine.shareAmount.toString(), e.currency),
					currency: e.currency,
				}
			: null,
		people: e.splitParticipants.map((sp) => person(refKey(sp), people)),
		payerId: payerKey,
		payerName: isMe(payer) ? null : person(payerKey, people).name,
		payerIsMe: isMe(payer),
		waiting,
		mine: isMe({
			participantType: e.createdByType,
			participantId: e.createdById,
		}),
		locked: e.isLocked,
	};
}

export type ProjectExpenseRow = ReturnType<typeof expenseRow>;

async function myRefs(db: PrismaClient, userId: string) {
	const me = { participantType: "user" as const, participantId: userId };
	const { aliasesByKey } = await resolveClaimAliases(db, [me]);
	const key = (r: Ref) => `${r.participantType}:${r.participantId}`;
	const keys = new Set((aliasesByKey.get(key(me)) ?? [me]).map(key));
	return (r: Ref) => keys.has(key(r));
}

export async function readProjectPage(
	db: PrismaClient,
	projectId: string,
	userId: string,
	/** The request's zone, for today. */
	timeZone?: string,
) {
	const [project, expenses, payments, isMe, numbers] = await Promise.all([
		loadProject(db, projectId),
		loadExpenses(db, projectId),
		loadPayments(db, projectId),
		myRefs(db, userId),
		readProjectNumbers(db, projectId, {
			participantType: "user",
			participantId: userId,
		}),
	]);
	const others = project.participants.filter((p) => !isMe(p));
	const [people, balances] = await Promise.all([
		batchResolveIdentities(db, [
			...project.participants,
			...expenses.flatMap((e) => [
				{ participantType: e.paidByType, participantId: e.paidById },
				...e.splitParticipants,
			]),
			...payments.flatMap((p) => [
				{
					participantType: p.fromParticipantType,
					participantId: p.fromParticipantId,
				},
				{
					participantType: p.toParticipantType,
					participantId: p.toParticipantId,
				},
			]),
		]),
		computeBalanceBatch(
			db,
			{ participantType: "user", participantId: userId },
			others,
			{ projectScope: projectId },
		),
	]);
	const meRow = project.participants.find(isMe);
	const myKey = `user:${userId}`;
	const myLine = numbers.members.find((m) => m.key === myKey)?.lines ?? [];
	const rows = expenses
		.slice(0, PAGE_ROWS)
		.map((e) => expenseRow(e, isMe, people));

	return {
		id: project.id,
		name: project.name,
		description: project.description,
		imageUrl: getImageUrl(project.imagePath),
		imagePath: project.imagePath,
		status: project.status,
		visibility: project.visibility,
		primaryCurrency: project.primaryCurrency,
		autoAcceptSplits: project.autoAcceptSplits,
		billingCycleLength: project.billingCycleLength,
		myRole: meRow?.role ?? null,
		excludeFromAnalytics: meRow?.excludeFromAnalytics ?? false,
		solo: others.length === 0,
		/** Today in the user's zone, for "Today" and the date pickers. */
		today: dayKey(new Date(), await userTimeZone(db, userId, timeZone)),
		expenseCount: expenses.length,
		firstExpense: expenses.length
			? day((expenses.at(-1) as Expense).date)
			: null,
		lastExpense: rows[0]?.date ?? null,
		total: numbers.total,
		myShare: myLine.map(
			(l): Money => ({ minor: l.share, currency: l.currency }),
		),
		budget: budgetOf(project, numbers.total),
		/** Everyone, you first, then in join order. */
		members: [...(meRow ? [meRow] : []), ...others].map((p) => {
			const i = others.indexOf(p);
			return {
				...person(refKey(p), people),
				participantType: p.participantType,
				participantId: p.participantId,
				isMe: i === -1,
				role: p.role,
				onRetrospend: p.participantType === "user",
				...membershipOf(p),
				/** Your balance with them in this project (`balance.person`, positive: they owe you). */
				withMe: i === -1 ? [] : linesOf(balances[i]?.minorByCurrency ?? {}),
			};
		}),
		byCategory: byCategory(
			expenses.map((e) => ({
				currency: e.currency,
				amount: e.amount,
				category: e.category,
				myShare: e.splitParticipants.find(isMe)?.shareAmount ?? null,
			})),
		),
		payments: payments.map((p) => ({
			id: p.id,
			from: person(
				refKey({
					participantType: p.fromParticipantType,
					participantId: p.fromParticipantId,
				}),
				people,
			),
			to: person(
				refKey({
					participantType: p.toParticipantType,
					participantId: p.toParticipantId,
				}),
				people,
			),
			amount: {
				minor: toMinor(p.amount.toString(), p.currency),
				currency: p.currency,
			},
			date: day(p.payment?.paidOn ?? p.initiatedAt),
			pending: p.status === "PROPOSED",
		})),
		openPeriod:
			project.billingPeriods.find((b) => b.status === "OPEN")?.id ?? null,
		expenses: rows,
	};
}

export type ProjectPageView = Awaited<ReturnType<typeof readProjectPage>>;

/** Whether the signed-in user is a member: the redesigned page is for members only. */
export async function isProjectMember(
	db: PrismaClient,
	projectId: string,
	userId: string,
): Promise<boolean> {
	const row = await db.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType: "user",
				participantId: userId,
			},
		},
		select: { id: true },
	});
	return row !== null;
}
