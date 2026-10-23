/**
 * Book setup (SPEC §4.3, build plan 02 §5.1 book.service): the style preset
 * to start from, and the one write that creates a personal book with its
 * period, owner, groups, envelopes, links and starting money (D34). Runs on
 * the caller's transaction (RLS set), so `setup.mutation.ts` previews it.
 */
import { randomUUID } from "node:crypto";
import { MissingRateError, USD } from "~/lib/money";
import type {
	SetupInput,
	SetupPresetOutput,
	TargetInput,
} from "~/lib/schemas/envelope";
import { Prisma } from "~prisma";
import { userTimeZone } from "../user-time-zone";
import { EnvelopeError } from "./errors";
import { findPersonalBook, monthStartInstant } from "./inputs";
import { forgetMonthViews } from "./month-read";
import { budgetMonthOf, isoDateIn } from "./months";
import { type SetupStyle, stylePreset } from "./presets";
import { RateBook } from "./rate-book";
import { REPEAT_MONTHS } from "./target-input";
import { savingsShape } from "./targets";
import { TargetConfigError } from "./types";
import { fromMinor } from "./units";

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
	return stylePreset({
		style,
		currency: user.homeCurrency,
		templates,
		categories,
	});
}

export interface SetupContext {
	now: Date;
	/** The request's zone; null falls back to userTimeZone and stays unconfirmed. */
	timeZone: string | null;
}

const KIND_FOR: Record<TargetInput["kind"], string> = {
	MONTHLY: "MONTHLY",
	BILL: "BILL",
	BILL_TEMPLATE: "BILL",
	SAVINGS: "SAVINGS",
};

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

function targetColumns(
	t: TargetInput | undefined,
	H: string,
	startMonth: number,
) {
	if (!t) return {};
	if (t.kind === "BILL_TEMPLATE")
		return { targetTemplateId: t.templateId, targetStartMonth: startMonth };
	const currency = t.currency ?? H;
	const foreign = currency === H ? null : currency;
	const amount = (minor: number | undefined) =>
		minor === undefined
			? null
			: new Prisma.Decimal(fromMinor(minor, currency).toString());
	const day = (d: string | undefined) =>
		d ? new Date(`${d}T00:00:00Z`) : null;
	const base = { targetCurrency: foreign, targetStartMonth: startMonth };
	if (t.kind === "MONTHLY")
		return {
			...base,
			targetAmount: amount(t.amountMinor),
			targetMode: t.mode,
			targetCadence: t.cadence,
		};
	if (t.kind === "BILL")
		return {
			...base,
			targetAmount: amount(t.amountMinor),
			targetDueDate: day(t.dueDate),
			targetRepeat: t.repeat,
		};
	return {
		...base,
		targetAmount: amount(t.amountMinor),
		targetDueDate: day(t.dueDate),
		targetMonthlyAmount: amount(t.monthlyMinor),
	};
}

async function rateTypeFor(tx: Tx, userId: string, currency: string) {
	const favorite = await tx.exchangeRateFavorite.findFirst({
		where: { userId, exchangeRate: { currency } },
		orderBy: { order: "asc" },
		select: { exchangeRate: { select: { type: true } } },
	});
	return favorite?.exchangeRate.type ?? "official";
}

/** The STARTING_BALANCE money-in row (D34), valued like any row: in H, with its USD value at the book rate. */
async function startingBalance(
	tx: Tx,
	userId: string,
	p: {
		minor: number;
		currency: string;
		rateType: string;
		date: Date;
		today: string;
	},
) {
	const amount = fromMinor(p.minor, p.currency);
	let rate = new Prisma.Decimal(1);
	if (p.currency !== USD) {
		const rates = await RateBook.load(tx, {
			bookCurrency: p.currency,
			rateTypes: [p.rateType, "official"],
			since: "1970-01-01",
		});
		const found =
			rates.lookup(p.currency, p.rateType, p.today) ??
			rates.lookup(p.currency, "official", p.today);
		if (!found) throw new MissingRateError(p.currency);
		rate = new Prisma.Decimal(found.toString());
	}
	return tx.expense.create({
		data: {
			userId,
			// Labeled by entryKind wherever it shows; no stored copy.
			title: "",
			amount: amount.toString(),
			currency: p.currency,
			date: p.date,
			amountInUSD: new Prisma.Decimal(amount.toString())
				.div(rate)
				.toDecimalPlaces(2),
			exchangeRate: rate.toDecimalPlaces(6),
			pricingSource: p.rateType,
			status: "FINALIZED",
			direction: "IN",
			entryKind: "STARTING_BALANCE",
		},
		select: { id: true },
	});
}

/** Creates the user's personal book from a setup the client edited (SPEC §4.3). */
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
	const timeZone = ctx.timeZone ?? (await userTimeZone(userId));
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
	const b = await bookSettings(tx, userId, input, ctx);
	const bookId = await createBook(tx, userId, input, b, ctx);
	const envelopeIds = await createEnvelopes(tx, bookId, input, b);
	const defaultKey = input.envelopes.find((e) => e.isDefault)?.key as string;
	// "I have nothing right now" is a confirmed answer with no row to write.
	const money = !input.startingMoneyMinor
		? null
		: await startingBalance(tx, userId, {
				minor: input.startingMoneyMinor,
				currency: b.currency,
				rateType: b.rateType,
				date: b.startDate,
				today: b.today,
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
	return { bookId, startingBalanceExpenseId: money?.id ?? null };
}
