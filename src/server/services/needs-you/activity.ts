/**
 * Activity items: recurring expenses and income due today or overdue, and
 * imported rows waiting for review. Plus the new-user setup prompts of the
 * Home mockup. One query per source, whatever the number of items.
 */
import { dayKey, startOfNextDayIn } from "@retrospend/domain/time-zone";
import { decimalMoney } from "~/server/services/expense-list/money";
import type { Prisma } from "~prisma";
import { item } from "./catalog";
import type { NeedsYouItem } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * The sidecar posts "pay automatically" fixed items every 15 minutes. One
 * still due an hour after its time did not post (usually a missing rate),
 * so it waits for the person; before that it would only flash by.
 */
export const AUTO_POST_GRACE_MS = 60 * 60 * 1000;

interface Template {
	id: string;
	name: string;
	amount: Prisma.Decimal;
	currency: string;
	direction: "IN" | "OUT";
	amountMode: "FIXED" | "ASK";
	autoPay: boolean;
	nextDueDate: Date;
}

/** Due today or overdue in the viewer's calendar, unless the sidecar is about to post it. */
export function recurringItems(
	templates: readonly Template[],
	now: Date,
	timeZone: string,
): NeedsYouItem[] {
	const today = dayKey(now, timeZone);
	return templates.flatMap((t) => {
		const next = dayKey(t.nextDueDate, timeZone);
		if (next > today) return [];
		const autoPosts = t.autoPay && t.amountMode === "FIXED";
		if (
			autoPosts &&
			now.getTime() - t.nextDueDate.getTime() < AUTO_POST_GRACE_MS
		)
			return [];
		const overdue = next < today;
		return [
			item(overdue ? "recurring.overdue" : "recurring.due", {
				key: t.id,
				entity: { kind: "recurring", id: t.id },
				amount: decimalMoney(t.amount, t.currency),
				date: next,
				title: t.name,
				attention: overdue,
				direction: t.direction === "IN" ? "in" : "out",
				askAmount: t.amountMode === "ASK",
			}),
		];
	});
}

export async function activityItems(
	tx: Tx,
	userId: string,
	now: Date,
	timeZone: string,
): Promise<NeedsYouItem[]> {
	const templates = await tx.recurringTemplate.findMany({
		where: {
			userId,
			isActive: true,
			nextDueDate: { lt: startOfNextDayIn(now, timeZone) },
		},
		select: {
			id: true,
			name: true,
			amount: true,
			currency: true,
			direction: true,
			amountMode: true,
			autoPay: true,
			nextDueDate: true,
		},
	});
	const jobs = await tx.importJob.findMany({
		where: { userId, status: { in: ["READY_FOR_REVIEW", "REVIEWING"] } },
		orderBy: [{ readyForReviewAt: "asc" }, { id: "asc" }],
		select: { id: true, totalTransactions: true, readyForReviewAt: true },
	});
	const first = jobs[0];
	const imports = first
		? [
				item("import.review", {
					entity: { kind: "importJob", id: first.id },
					entityIds: jobs.map((j) => j.id),
					count: jobs.reduce((t, j) => t + j.totalTransactions, 0),
					date: first.readyForReviewAt
						? dayKey(first.readyForReviewAt, timeZone)
						: null,
				}),
			]
		: [];
	return [...recurringItems(templates, now, timeZone), ...imports];
}

/**
 * New-user prompts (Home mockup, state "new"): with no expense at all, add
 * one, pick the home currency, import a statement (unless one was started).
 * Verify your email shows until the address is verified.
 */
export async function setupItems(
	tx: Tx,
	user: { id: string; emailVerified: boolean },
): Promise<NeedsYouItem[]> {
	const userEntity = { kind: "user" as const, id: user.id };
	const out: NeedsYouItem[] = [];
	const anyExpense = await tx.expense.findFirst({
		where: { userId: user.id },
		select: { id: true },
	});
	if (!anyExpense) {
		const anyImport = await tx.importJob.findFirst({
			where: { userId: user.id },
			select: { id: true },
		});
		out.push(item("setup.firstExpense", { entity: userEntity }));
		out.push(item("setup.homeCurrency", { entity: userEntity }));
		if (!anyImport)
			out.push(item("setup.importStatement", { entity: userEntity }));
	}
	if (!user.emailVerified)
		out.push(item("setup.verifyEmail", { entity: userEntity }));
	return out;
}
