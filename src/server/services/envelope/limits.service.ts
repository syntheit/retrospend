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
	SetLimitInput,
	SetLimitResult,
} from "~/lib/schemas/envelope-book";
import { Prisma } from "~prisma";
import { budgetSpendingWhere } from "../spending";
import { userTimeZone } from "../user-time-zone";
import { addMonths, calendarMonthOf } from "./calendar";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import { isoDateIn } from "./months";
import { insert, replay, result } from "./movement.service";
import { checkEnvelope, lockedSnapshot, type NewMovement } from "./movement-state";
import { RateBook } from "./rate-book";
import type { MissingRate } from "./types";
import { fromMinor, toMinor } from "./units";
import { valueRow } from "./valuation";

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
				lte: new Date(new Date(`${firstOf(thisMonth)}T00:00:00Z`).getTime() - 1),
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

/** What this month's plan funding gave the envelope, net of later deltas and undos. */
async function fundedThisMonth(
	tx: Tx,
	bookId: string,
	envelopeId: string,
	month: number,
	currency: string,
) {
	const rows = await tx.budgetMovement.findMany({
		where: {
			bookId,
			month,
			kind: "PLAN_FUND",
			OR: [{ toEnvelopeId: envelopeId }, { fromEnvelopeId: envelopeId }],
		},
		select: { id: true, amount: true, toEnvelopeId: true },
	});
	const undone = new Set(
		(
			await tx.budgetMovement.findMany({
				where: { revertsId: { in: rows.map((r) => r.id) } },
				select: { revertsId: true },
			})
		).map((r) => r.revertsId),
	);
	return rows
		.filter((r) => !undone.has(r.id))
		.reduce((t, r) => {
			const v = toMinor(r.amount.toString(), currency);
			return t + (r.toEnvelopeId === envelopeId ? v : -v);
		}, 0);
}

export async function setLimit(
	tx: Tx,
	userId: string,
	input: SetLimitInput,
	now: Date,
): Promise<SetLimitResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const H = s.loaded.book.currency;
	if (s.loaded.book.fundingSource !== "TARGETS")
		throw new EnvelopeError("INVALID", "limits belong to a Limits budget");
	checkEnvelope(input.envelopeId, s);
	const env = s.loaded.row.envelopes.find((e) => e.id === input.envelopeId);
	if (!env || (env.kind !== "MONTHLY" && env.kind !== "NONE"))
		throw new EnvelopeError("INVALID", "bills and goals keep their own targets");
	const funded = await fundedThisMonth(tx, s.loaded.row.id, env.id, s.current, H);
	const money = (minor: number) => ({ minor, currency: H });
	const retry = await replay(tx, userId, now, s, { id: input.id }, (rows) =>
		rows.every(
			(r) =>
				r.kind === "PLAN_FUND" &&
				(r.toEnvelopeId === env.id || r.fromEnvelopeId === env.id),
		),
	);
	if (retry)
		return {
			...retry,
			envelopeId: env.id,
			limit: money(input.amountMinor),
			previous: money(
				funded -
					retry.movements.reduce(
						(t, m) => t + (m.to === env.id ? m.amount.minor : -m.amount.minor),
						0,
					),
			),
			scope: input.scope,
			previousTarget: null,
		};
	const delta = input.amountMinor - funded;
	if (delta === 0 && input.scope === "THIS_MONTH")
		throw new EnvelopeError("INVALID", "that is the limit already");
	const rows: NewMovement[] =
		delta === 0
			? []
			: [
					{
						id: input.id,
						month: s.current,
						from: delta > 0 ? null : env.id,
						to: delta > 0 ? env.id : null,
						minor: Math.abs(delta),
						kind: "PLAN_FUND",
						batchId: null,
					},
				];
	const previousTarget =
		env.targetAmount && env.targetCurrency === null
			? money(toMinor(env.targetAmount.toString(), H))
			: null;
	if (input.scope === "FROM_NOW_ON")
		await tx.envelope.update({
			where: { id: env.id },
			data: {
				kind: "MONTHLY",
				targetAmount: new Prisma.Decimal(
					fromMinor(input.amountMinor, H).toString(),
				),
				targetCurrency: null,
				targetMode: "SET_ASIDE",
				targetCadence: "MONTH",
				targetStartMonth: env.targetStartMonth ?? s.current,
			},
		});
	await insert(tx, s, userId, rows);
	forgetMonthViews(tx);
	const moved = await result(tx, userId, now, s, rows.map((r) => r.id));
	return {
		...moved,
		envelopeId: env.id,
		limit: money(input.amountMinor),
		previous: money(funded),
		scope: input.scope,
		previousTarget,
	};
}
