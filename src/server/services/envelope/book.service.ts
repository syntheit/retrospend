/**
 * Book setup (SPEC §4.3, build plan 02 §5.1 book.service): the style preset
 * to start from, and the one write that creates a personal book with its
 * period, owner, groups, envelopes, links and starting money (D34). Runs on
 * the caller's transaction (RLS set), so `setup.mutation.ts` previews it.
 */
import { randomUUID } from "node:crypto";
import type { SetupInput, SetupPresetOutput } from "~/lib/schemas/envelope";
import type { Prisma } from "~prisma";
import { userTimeZone } from "../user-time-zone";
import { writeEntryRow } from "./adjustment";
import { EnvelopeError } from "./errors";
import { findPersonalBook, monthStartInstant } from "./inputs";
import { recentSpending } from "./limits.service";
import { planFund } from "./month-close.service";
import { forgetMonthViews } from "./month-read";
import { budgetMonthOf, isoDateIn } from "./months";
import { type SetupStyle, stylePreset } from "./presets";
import {
	groupTargetColumns,
	validateSetupExtras,
	writeSetupExtras,
} from "./setup-p5";
import { REPEAT_MONTHS } from "./target-input";
import { KIND_FOR, LIABILITY_TYPES, targetColumns } from "./target-write";
import { savingsShape } from "./targets";
import { TargetConfigError } from "./types";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

export async function setupPreset(
	tx: Tx,
	userId: string,
	style: SetupStyle,
): Promise<SetupPresetOutput> {
	const user = await tx.user.findUniqueOrThrow({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	const templates = await tx.recurringTemplate.findMany({
		where: { userId, isActive: true, direction: "OUT" },
		orderBy: { nextDueDate: "asc" },
		select: { id: true, name: true, categoryId: true, frequency: true },
	});
	const categories = await tx.category.findMany({
		where: { userId, kind: "EXPENSE" },
		orderBy: { name: "asc" },
		select: { id: true, name: true, isFixed: true },
	});
	const recent =
		style === "LIMITS"
			? await recentSpending(
					tx,
					userId,
					user.homeCurrency,
					await rateTypeFor(tx, userId, user.homeCurrency),
					new Date(),
				)
			: null;
	const liabilities =
		style === "DEBT_PAYOFF"
			? await tx.assetAccount.findMany({
					where: {
						type: { in: [...LIABILITY_TYPES] },
						closedAt: null,
						minimumPayment: { gt: 0 },
					},
					orderBy: { createdAt: "asc" },
					select: { id: true, name: true },
				})
			: [];
	return stylePreset({
		style,
		currency: user.homeCurrency,
		templates,
		categories,
		liabilities,
		spent: recent?.spent,
		unit: toMinor("1", user.homeCurrency),
		missingRates: recent?.missingRates ?? [],
	});
}

export interface SetupContext {
	now: Date;
	/** The request's zone; null falls back to userTimeZone and stays unconfirmed. */
	timeZone: string | null;
}

function invalid(message: string): never {
	throw new EnvelopeError("INVALID", message);
}

async function validate(tx: Tx, input: SetupInput) {
	const groupKeys = new Set<string>();
	for (const g of input.groups) {
		if (groupKeys.has(g.key)) invalid(`group key ${g.key} is used twice`);
		groupKeys.add(g.key);
	}
	const keys = new Set<string>();
	const categories = new Set<string>();
	const templateIds: string[] = [];
	const liabilityIds: string[] = [];
	for (const e of input.envelopes) {
		if (keys.has(e.key)) invalid(`envelope key ${e.key} is used twice`);
		keys.add(e.key);
		if (e.groupKey && !groupKeys.has(e.groupKey))
			invalid(`envelope ${e.key} names an unknown group`);
		for (const c of e.categoryIds) {
			if (categories.has(c))
				invalid("a category can belong to one envelope only");
			categories.add(c);
		}
		if (e.isDefault && e.kind !== "MONTHLY" && e.kind !== "NONE")
			invalid("Everything else is a Monthly or No target envelope");
		if (!e.target) continue;
		if (KIND_FOR[e.target.kind] !== e.kind)
			invalid(
				`envelope ${e.key}: a ${e.target.kind} target needs a ${KIND_FOR[e.target.kind]} envelope`,
			);
		if (e.target.kind === "BILL_TEMPLATE")
			templateIds.push(e.target.templateId);
		if (e.target.kind === "BILL_LIABILITY")
			liabilityIds.push(e.target.liabilityId);
		if (e.target.kind === "SAVINGS") {
			try {
				savingsShape({
					amount: e.target.amountMinor,
					dueMonth: e.target.dueDate ? 1 : null,
					monthly: e.target.monthlyMinor,
				});
			} catch (error) {
				if (error instanceof TargetConfigError)
					invalid(`envelope ${e.key}: ${error.message}`);
				throw error;
			}
		}
	}
	// RLS shows only the user's own rows, so a count below the ids asked means foreign or missing ids.
	const ownCategories = await tx.category.count({
		where: { id: { in: [...categories] }, kind: "EXPENSE" },
	});
	if (ownCategories !== categories.size) invalid("unknown or income category");
	// RLS shows only the user's own accounts.
	const liabilities = await tx.assetAccount.count({
		where: { id: { in: liabilityIds }, type: { in: [...LIABILITY_TYPES] } },
	});
	if (liabilities !== new Set(liabilityIds).size)
		invalid("a bill follows one of your debts");
	const templates = await tx.recurringTemplate.findMany({
		where: { id: { in: templateIds }, direction: "OUT" },
		select: { id: true, frequency: true },
	});
	if (
		templates.length !== new Set(templateIds).size ||
		templates.some((t) => REPEAT_MONTHS[t.frequency] === undefined)
	)
		invalid(
			"a bill follows a recurring expense that repeats monthly, quarterly or yearly",
		);
}

export async function rateTypeFor(tx: Tx, userId: string, currency: string) {
	const favorite = await tx.exchangeRateFavorite.findFirst({
		where: { userId, exchangeRate: { currency } },
		orderBy: { order: "asc" },
		select: { exchangeRate: { select: { type: true } } },
	});
	return favorite?.exchangeRate.type ?? "official";
}

/** Limits is plan-funded (SPEC §5.6); every other style is funded from money in. */
export function fundingSourceFor(style: string): "INCOME" | "TARGETS" {
	return style === "LIMITS" ? "TARGETS" : "INCOME";
}

/** A style's leftover rule for Monthly envelopes (SPEC §5.7): Limits starts fresh each month. */
export function leftoverDefault(style: string): "CARRY" | "RETURN" {
	return style === "LIMITS" ? "RETURN" : "CARRY";
}

interface BookSettings {
	currency: string;
	timeZone: string;
	startDay: number;
	today: string;
	startMonth: number;
	startDate: Date;
	rateType: string;
}

/** Currency, zone, month start and rate type the new book starts with (SPEC §5.1). */
async function bookSettings(
	tx: Tx,
	userId: string,
	input: SetupInput,
	ctx: SetupContext,
): Promise<BookSettings> {
	const user = await tx.user.findUniqueOrThrow({
		where: { id: userId },
		select: { homeCurrency: true, fiscalMonthStartDay: true },
	});
	const currency = input.currency ?? user.homeCurrency;
	const timeZone = ctx.timeZone ?? (await userTimeZone(tx, userId));
	const startDay = Math.min(28, Math.max(1, user.fiscalMonthStartDay));
	const today = isoDateIn(ctx.now, timeZone);
	const startMonth = budgetMonthOf(today, [{ fromMonth: 0, startDay }]);
	return {
		currency,
		timeZone,
		startDay,
		today,
		startMonth,
		startDate: monthStartInstant(startMonth, startDay, timeZone),
		rateType: await rateTypeFor(tx, userId, currency),
	};
}

/** The book, its owner and its first period. A second setup racing this one hits the one-book index. */
async function createBook(
	tx: Tx,
	userId: string,
	input: SetupInput,
	b: BookSettings,
	ctx: SetupContext,
) {
	const bookId = randomUUID();
	try {
		await tx.budgetBook.create({
			data: {
				id: bookId,
				currency: b.currency,
				style: input.style,
				fundingSource: fundingSourceFor(input.style),
				weekStartDay: input.weekStartDay ?? 1,
				monthStartDay: b.startDay,
				timeZone: b.timeZone,
				timeZoneConfirmed: ctx.timeZone !== null,
				startDate: b.startDate,
				startMonth: b.startMonth,
				createdById: userId,
			},
		});
	} catch (error) {
		if ((error as { code?: string }).code === "P2002")
			throw new EnvelopeError("BOOK_EXISTS", "you already have a budget");
		throw error;
	}
	await tx.budgetMember.create({ data: { bookId, userId, role: "OWNER" } });
	await tx.bookPeriod.create({
		data: {
			bookId,
			fromMonth: b.startMonth,
			startDay: b.startDay,
			rateType: b.rateType,
		},
	});
	return bookId;
}

/** Groups, envelopes and category links as the client sent them; returns envelope ids by key. */
async function createEnvelopes(
	tx: Tx,
	bookId: string,
	input: SetupInput,
	b: BookSettings,
) {
	const groupIds = new Map(input.groups.map((g) => [g.key, randomUUID()]));
	await tx.envelopeGroup.createMany({
		data: input.groups.map((g, i) => ({
			id: groupIds.get(g.key) as string,
			bookId,
			name: g.name,
			role: g.role,
			sortOrder: i,
			...groupTargetColumns(g.target, b.currency),
		})),
	});
	const envelopeIds = new Map(
		input.envelopes.map((e) => [e.key, randomUUID()]),
	);
	await tx.envelope.createMany({
		data: input.envelopes.map((e, i) => ({
			id: envelopeIds.get(e.key) as string,
			bookId,
			groupId: e.groupKey ? (groupIds.get(e.groupKey) ?? null) : null,
			name: e.name,
			icon: e.icon ?? null,
			kind: e.kind,
			leftoverRule: leftoverDefault(input.style),
			sortOrder: i,
			...targetColumns(e.target, b.currency, b.startMonth),
		})),
	});
	await tx.envelopeCategory.createMany({
		data: input.envelopes.flatMap((e) =>
			e.categoryIds.map((categoryId) => ({
				bookId,
				envelopeId: envelopeIds.get(e.key) as string,
				categoryId,
			})),
		),
	});
	return envelopeIds;
}

/** Creates the user's personal book from a setup the client edited (SPEC §4.3). */
export async function setupBook(
	tx: Tx,
	userId: string,
	input: SetupInput,
	ctx: SetupContext,
): Promise<{ bookId: string; startingBalanceExpenseId: string | null }> {
	if (await findPersonalBook(tx, userId))
		throw new EnvelopeError("BOOK_EXISTS", "you already have a budget");
	await validate(tx, input);
	await validateSetupExtras(tx, input);
	const b = await bookSettings(tx, userId, input, ctx);
	const bookId = await createBook(tx, userId, input, b, ctx);
	const envelopeIds = await createEnvelopes(tx, bookId, input, b);
	await writeSetupExtras(tx, {
		bookId,
		input,
		envelopeIds,
		currency: b.currency,
		now: ctx.now,
	});
	const defaultKey = input.envelopes.find((e) => e.isDefault)?.key as string;
	// "I have nothing right now" is a confirmed answer with no row to write.
	const money = !input.startingMoneyMinor
		? null
		: await writeEntryRow(tx, userId, {
				minor: input.startingMoneyMinor,
				currency: b.currency,
				rateType: b.rateType,
				date: b.startDate,
				today: b.today,
				direction: "IN",
				entryKind: "STARTING_BALANCE",
			});
	await tx.budgetBook.update({
		where: { id: bookId },
		data: {
			defaultEnvelopeId: envelopeIds.get(defaultKey),
			startingBalanceExpenseId: money?.id ?? null,
			startingMoneyConfirmedAt:
				input.startingMoneyMinor === undefined ? null : ctx.now,
		},
	});
	forgetMonthViews(tx);
	// "Your limits start now" (SPEC §4.3 step 5): this month is funded at setup.
	if (fundingSourceFor(input.style) === "TARGETS")
		await planFund(tx, userId, ctx.now);
	return { bookId, startingBalanceExpenseId: money?.id ?? null };
}
