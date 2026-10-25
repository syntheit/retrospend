/**
 * Money-in rows the budget writes itself (SPEC §5.2, §12.1): the starting
 * balance (D34) and Adjustments (reconcile, Welcome back "Set what I have
 * now", leaving Limits). Each is an expense row in the book currency with
 * its USD value at the book rate type on the day, labeled by its entry kind
 * (no stored title). An Adjustment is signed by direction: IN raises To
 * assign, OUT lowers it. Reports ignore both kinds.
 */
import { MissingRateError, USD } from "~/lib/money";
import type { Adjustment } from "~/lib/schemas/envelope-book";
import { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import { RateBook } from "./rate-book";
import type { IsoDate } from "./types";
import { fromMinor, toMinor } from "./units";

type Tx = Prisma.TransactionClient;

export interface EntryRow {
	/** Client id (an Adjustment's retry key); generated when absent. */
	id?: string;
	/** Positive minor units of `currency`. */
	minor: number;
	currency: string;
	rateType: string;
	date: Date;
	/** The calendar day whose rate values it. */
	today: IsoDate;
	direction: "IN" | "OUT";
	entryKind: "STARTING_BALANCE" | "ADJUSTMENT";
}

/** Writes one budget money-in row; a missing USD rate refuses (never 1). */
export async function writeEntryRow(tx: Tx, userId: string, p: EntryRow) {
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
	const row = await tx.expense.create({
		data: {
			...(p.id ? { id: p.id } : {}),
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
			direction: p.direction,
			entryKind: p.entryKind,
		},
		select: { id: true },
	});
	forgetMonthViews(tx);
	return row;
}

/**
 * An Adjustment of `signedMinor` (0 writes nothing). A retry with the same
 * id returns the row it wrote; an id used for anything else is refused.
 */
export async function writeAdjustment(
	tx: Tx,
	userId: string,
	p: Omit<EntryRow, "minor" | "direction" | "entryKind" | "id"> & {
		id: string;
		signedMinor: number;
	},
): Promise<Adjustment> {
	const existing = await tx.expense.findUnique({
		where: { id: p.id },
		select: {
			userId: true,
			entryKind: true,
			direction: true,
			amount: true,
			currency: true,
		},
	});
	if (existing) {
		if (existing.userId !== userId || existing.entryKind !== "ADJUSTMENT")
			throw new EnvelopeError("ID_REUSED", "that id was already used");
		const minor = toMinor(existing.amount.toString(), existing.currency);
		return {
			expenseId: p.id,
			amount: {
				minor: existing.direction === "IN" ? minor : -minor,
				currency: existing.currency,
			},
		};
	}
	if (p.signedMinor === 0)
		return { expenseId: null, amount: { minor: 0, currency: p.currency } };
	await writeEntryRow(tx, userId, {
		...p,
		minor: Math.abs(p.signedMinor),
		direction: p.signedMinor > 0 ? "IN" : "OUT",
		entryKind: "ADJUSTMENT",
	});
	return {
		expenseId: p.id,
		amount: { minor: p.signedMinor, currency: p.currency },
	};
}

/** The undo of an Adjustment: removes the row, only an Adjustment of yours. */
export async function removeAdjustment(
	tx: Tx,
	userId: string,
	expenseId: string,
): Promise<Adjustment> {
	const row = await tx.expense.findFirst({
		where: { id: expenseId, userId, entryKind: "ADJUSTMENT" },
		select: { amount: true, currency: true, direction: true },
	});
	if (!row) throw new EnvelopeError("NOT_FOUND", "no such adjustment");
	await tx.expense.delete({ where: { id: expenseId } });
	forgetMonthViews(tx);
	const minor = toMinor(row.amount.toString(), row.currency);
	return {
		expenseId,
		amount: {
			minor: row.direction === "IN" ? -minor : minor,
			currency: row.currency,
		},
	};
}
