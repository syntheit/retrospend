/**
 * Limits (SPEC §5.6, owner Q1, A2): a plan-funded book. Each month opens
 * with a PLAN_FUND batch (month-close.service.ts); this file holds the rest:
 *
 * - recentSpending: what each category spent over the last 3 full months,
 *   valued in the book currency, for the Limits setup proposal;
 * - setLimit: editing a limit during the month ("Only this month" or "From
 *   now on") writes a PLAN_FUND delta against what the month's plan funding
 *   gave the envelope; "From now on" also stores the new limit as the
 *   envelope's "Set aside" target, so next month funds it. A lower limit can
 *   leave the envelope negative (B5: PLAN_FUND never blocks).
 */
import type {
	RevertLimitInput,
	RevertLimitResult,
	SetLimitInput,
	SetLimitResult,
} from "~/lib/schemas/envelope-book";
import { Prisma } from "~prisma";
import { budgetSpendingWhere } from "../spending";
import { userTimeZone } from "../user-time-zone";
import { addMonths, calendarMonthOf } from "./calendar";
import { EnvelopeError } from "./errors";
import {
	fundDelta,
	fundedThisMonth,
	restoreData,
	snapshotOf,
} from "./limit-target";
import { forgetMonthViews } from "./month-read";
import { isoDateIn } from "./months";
import { insert, replay, result } from "./movement.service";
import { checkEnvelope, lockedSnapshot } from "./movement-state";
import { RateBook } from "./rate-book";
import type { MissingRate } from "./types";
import { fromMinor, toMinor } from "./units";
import { convertToBookOrThrow, valueRow } from "./valuation";

type Tx = Prisma.TransactionClient;

const firstOf = (month: number) =>
	`${Math.floor(month / 100)}-${String(month % 100).padStart(2, "0")}-01`;

/** Spending per category over the last 3 full calendar months, in `currency` minor units. */
export async function recentSpending(
	tx: Tx,
	userId: string,
	currency: string,
	rateType: string,
	now: Date,
): Promise<{ spent: Map<string, number>; missingRates: MissingRate[] }> {
	const zone = await userTimeZone(tx, userId);
	const thisMonth = calendarMonthOf(isoDateIn(now, zone));
	const from = firstOf(addMonths(thisMonth, -3));
	const rows = await tx.expense.findMany({
		where: {
			...budgetSpendingWhere(userId, {
				gte: new Date(`${from}T00:00:00Z`),
				lte: new Date(
					new Date(`${firstOf(thisMonth)}T00:00:00Z`).getTime() - 1,
				),
			}),
			categoryId: { not: null },
		},
		select: {
			id: true,
			amount: true,
			currency: true,
			amountInUSD: true,
			date: true,
			categoryId: true,
		},
	});
	const rates = await RateBook.load(tx, {
		bookCurrency: currency,
		rateTypes: [rateType, "official"],
		since: from,
	});
	const spent = new Map<string, number>();
	const missingRates: MissingRate[] = [];
	for (const r of rows) {
		const date = r.date.toISOString().slice(0, 10);
		const v = valueRow(
			{
				id: r.id,
				amount: r.amount.toString(),
				currency: r.currency,
				date,
				month: calendarMonthOf(date),
				amountInUSD: r.amountInUSD.toString(),
			},
			{
				bookCurrency: currency,
				periods: [],
				defaultRateType: rateType,
				usdRate: rates.lookup,
			},
		);
		if (!v.ok) {
			missingRates.push(v.missing);
			continue;
		}
		const id = r.categoryId as string;
		spent.set(id, (spent.get(id) ?? 0) + v.minor);
	}
	return { spent, missingRates };
}

/** The Limits envelope a limit edit acts on, under the book lock. */
async function limitEnvelope(
	tx: Tx,
	userId: string,
	envelopeId: string,
	now: Date,
) {
	const s = await lockedSnapshot(tx, userId, now);
	if (s.loaded.book.fundingSource !== "TARGETS")
		throw new EnvelopeError("INVALID", "limits belong to a Limits budget");
	checkEnvelope(envelopeId, s);
	const env = s.loaded.row.envelopes.find((e) => e.id === envelopeId);
	if (!env || (env.kind !== "MONTHLY" && env.kind !== "NONE"))
		throw new EnvelopeError(
			"INVALID",
			"bills and goals keep their own targets",
		);
	const funded = await fundedThisMonth(tx, {
		bookId: s.loaded.row.id,
		envelopeId,
		month: s.current,
		currency: s.loaded.book.currency,
	});
	return { s, env, funded };
}

/** A limit typed in another currency, in the book currency at today's rate (D25); no rate refuses. */
async function inBook(
	tx: Tx,
	s: Awaited<ReturnType<typeof limitEnvelope>>["s"],
	amountMinor: number,
	currency: string,
) {
	const H = s.loaded.book.currency;
	if (currency === H) return amountMinor;
	const rates = await RateBook.load(tx, {
		bookCurrency: H,
		rateTypes: [s.loaded.valuation.defaultRateType, "official"],
		since: "1970-01-01",
		extraCurrencies: [currency],
	});
	return convertToBookOrThrow(
		fromMinor(amountMinor, currency).toString(),
		currency,
		{ date: s.loaded.today, month: s.current, foreignRateType: "official" },
		{ ...s.loaded.valuation, usdRate: rates.lookup },
	);
}

export async function setLimit(
	tx: Tx,
	userId: string,
	input: SetLimitInput,
	now: Date,
): Promise<SetLimitResult> {
	const { s, env, funded } = await limitEnvelope(
		tx,
		userId,
		input.envelopeId,
		now,
	);
	const H = s.loaded.book.currency;
	const currency = input.currency ?? H;
	const toBook = await inBook(tx, s, input.amountMinor, currency);
	const previousTarget = snapshotOf(env);
	const base = {
		envelopeId: env.id,
		limit: { minor: input.amountMinor, currency },
		limitInBook: { minor: toBook, currency: H },
		scope: input.scope,
		previousTarget,
	};
	// A retry returns what the first call wrote (the target is already stored).
	const retry = await replay(tx, userId, now, s, { id: input.id }, (stored) =>
		stored.every(
			(r) =>
				r.kind === "PLAN_FUND" &&
				(r.toEnvelopeId === env.id || r.fromEnvelopeId === env.id),
		),
	);
	if (retry) {
		const signed = retry.movements.reduce(
			(t, m) => t + (m.to === env.id ? m.amount.minor : -m.amount.minor),
			0,
		);
		return { ...retry, ...base, previous: { minor: funded - signed, currency: H } };
	}
	const rows = fundDelta({
		id: input.id,
		envelopeId: env.id,
		month: s.current,
		funded,
		to: toBook,
	});
	if (rows.length === 0 && input.scope === "THIS_MONTH")
		throw new EnvelopeError("INVALID", "that is the limit already");
	if (input.scope === "FROM_NOW_ON")
		await tx.envelope.update({
			where: { id: env.id },
			data: {
				kind: "MONTHLY",
				targetAmount: new Prisma.Decimal(
					fromMinor(input.amountMinor, currency).toString(),
				),
				// The currency typed stays, converted each month (owner, D25).
				targetCurrency: currency === H ? null : currency,
				targetMode: "SET_ASIDE",
				targetCadence: "MONTH",
				targetStartMonth: env.targetStartMonth ?? s.current,
			},
		});
	await insert(tx, s, userId, rows);
	forgetMonthViews(tx);
	const moved = await result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
	return { ...moved, ...base, previous: { minor: funded, currency: H } };
}

/** The undo of a limit edit: the target exactly as it was, this month funded back to what it was. */
export async function revertLimit(
	tx: Tx,
	userId: string,
	input: RevertLimitInput,
	now: Date,
): Promise<RevertLimitResult> {
	const { s, env, funded } = await limitEnvelope(
		tx,
		userId,
		input.envelopeId,
		now,
	);
	await tx.envelope.update({
		where: { id: env.id },
		data: restoreData(input.previousTarget),
	});
	const rows = fundDelta({
		id: input.id,
		envelopeId: env.id,
		month: s.current,
		funded,
		to: input.fundedMinor,
	});
	await insert(tx, s, userId, rows);
	forgetMonthViews(tx);
	const moved = await result(
		tx,
		userId,
		now,
		s,
		rows.map((r) => r.id),
	);
	return { ...moved, envelopeId: env.id };
}

