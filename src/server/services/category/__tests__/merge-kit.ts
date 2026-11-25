/**
 * Seeds for the category merge pg tests: a person whose home currency is ARS
 * (rows booked at the blue rate, 1 USD = 1,545 ARS), their categories and
 * every kind of row and setting that holds a category id.
 */
import { randomUUID } from "node:crypto";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	mergeCategories,
	restoreCategory,
} from "../merge.mutation";

export const BLUE = 1545;

export async function arsUser() {
	const made = await createTestUser();
	await adminDb.user.update({
		where: { id: made.user.id },
		data: { homeCurrency: "ARS" },
	});
	return made.user.id;
}

export const category = (
	userId: string,
	name: string,
	extra: Partial<Prisma.CategoryUncheckedCreateInput> = {},
) =>
	fixtureDb.category.create({
		data: { name, color: "blue", userId, ...extra },
	});

/** A USD expense booked at blue: `usd` dollars are usd * 1,545 pesos. */
export function expense(
	userId: string,
	categoryId: string | null,
	usd: number,
	extra: Partial<Prisma.ExpenseUncheckedCreateInput> = {},
) {
	return fixtureDb.expense.create({
		data: {
			userId,
			title: "Lunch",
			amount: new Prisma.Decimal(usd),
			currency: "USD",
			date: new Date("2026-10-12T15:00:00Z"),
			categoryId,
			amountInUSD: new Prisma.Decimal(usd),
			exchangeRate: new Prisma.Decimal(1),
			pricingSource: "MANUAL",
			rateType: "blue",
			homeCurrency: "ARS",
			homeRate: new Prisma.Decimal(BLUE),
			homeAmount: new Prisma.Decimal(usd * BLUE),
			...extra,
		},
	});
}

export const templateOf = (userId: string, categoryId: string) =>
	fixtureDb.recurringTemplate.create({
		data: {
			userId,
			name: "Gym",
			amount: "20",
			categoryId,
			frequency: "MONTHLY",
			nextDueDate: new Date("2026-12-01T00:00:00Z"),
		},
	});

/** A split someone else made, shared with `userId`, filed under `categoryId` by raw write. */
export async function sharedTx(
	creatorId: string,
	categoryId: string | null,
	extra: Partial<Prisma.SharedTransactionUncheckedCreateInput> = {},
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount: "30",
			currency: "USD",
			date: new Date("2026-10-14T20:00:00Z"),
			categoryId,
			paidByType: "user",
			paidById: creatorId,
			createdByType: "user",
			createdById: creatorId,
			...extra,
		},
	});
}

export const shareOf = (
	transactionId: string,
	userId: string,
	categoryId: string | null,
	extra: Partial<Prisma.SplitParticipantUncheckedCreateInput> = {},
) =>
	adminDb.splitParticipant.create({
		data: {
			transactionId,
			participantType: "user",
			participantId: userId,
			shareAmount: "15",
			categoryId,
			categorySource: categoryId ? "USER" : null,
			...extra,
		},
	});

export const run = (userId: string, id: string, targetId: string | null) =>
	forUser(userId).apply(mergeCategories, { id, targetId });

export const dry = (userId: string, id: string, targetId: string | null) =>
	forUser(userId).preview(mergeCategories, { id, targetId });

export const undo = (userId: string, stash: string) =>
	forUser(userId).apply(restoreCategory, { stash });

export const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

export const cuid = () => randomUUID();
