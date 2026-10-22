/**
 * Fixture ledger for the money-moves tests, ported from the mockup kit
 * (`kit/data.js`, MONEY-MOVES §1.3 to §1.7): Sofía (ARS home) and the
 * people she shares with. Amounts are minor units, signed from Sofía's side
 * (positive = they owe her). Rates are the kit's: BRL Blue 271 and Official
 * 262, USD Blue 1,468 (ARS per unit).
 *
 * The fixture records payments through the production pieces only
 * (allocatePayment, confirmationFor, countsFor), so the invariant tests
 * check the engine, not a copy of it.
 */
import { dec } from "~/server/services/envelope/units";
import type { Allocation } from "./allocate";
import { allocatePayment, plannedSettlements, quote } from "./allocate";
import { confirmationFor, swappedFlags } from "./confirmation";
import { countsFor, ledgerLines, type PairEvent, payerLines } from "./ledger";
import type { ApplyTo, IsoDate, Minor, Quote, Scope } from "./types";

export const FLORIPA = "floripa";
export const DEPTO = "depto";
export const TODAY = "2026-10-21";

/** Sofía's reference quotes into ARS (Blue). */
export const BLUE: ReadonlyMap<string, Quote> = new Map([
	["BRL", quote("271", "blue")],
	["USD", quote("1468", "blue")],
]);

export const OFFICIAL: ReadonlyMap<string, Quote> = new Map([
	["BRL", quote("262", "official")],
	["USD", quote("1412", "official")],
]);

/** Quotes into USD for someone paying in dollars (crossed through Blue). */
export const INTO_USD: ReadonlyMap<string, Quote> = new Map([
	["ARS", quote(dec(1).div(1468), "blue")],
	["BRL", quote(dec(271).div(1468), "blue")],
]);

export type Who = "me" | "them";

interface ShareRecord {
	readonly kind: "share";
	readonly title: string;
	readonly date: IsoDate;
	readonly scope: Scope;
	readonly currency: string;
	readonly minor: Minor;
}

export interface RowRecord {
	readonly kind: "row";
	readonly paymentId: string;
	readonly date: IsoDate;
	readonly scope: Scope;
	readonly currency: string;
	readonly amount: Minor;
	readonly from: Who;
	status: "PROPOSED" | "FINALIZED" | "REJECTED";
	confirmedByPayer: boolean;
	confirmedByPayee: boolean;
	readonly isOffset: boolean;
	readonly paid: Minor;
}

export interface FixturePerson {
	readonly id: string;
	readonly onRetrospend: boolean;
	readonly records: Array<ShareRecord | RowRecord>;
}

const share = (
	title: string,
	date: IsoDate,
	scope: Scope,
	currency: string,
	minor: Minor,
): ShareRecord => ({ kind: "share", title, date, scope, currency, minor });

function finalRow(
	paymentId: string,
	date: IsoDate,
	scope: Scope,
	currency: string,
	amount: Minor,
	from: Who,
): RowRecord {
	return {
		kind: "row",
		paymentId,
		date,
		scope,
		currency,
		amount,
		from,
		status: "FINALIZED",
		confirmedByPayer: true,
		confirmedByPayee: true,
		isOffset: false,
		paid: amount,
	};
}

/** A fresh copy of the ledger, so each test records into its own. */
export function fixtureLedger(): Record<
	"martin" | "lucia" | "paz" | "valentina",
	FixturePerson
> {
	return {
		// Example A: Sofía owes ARS 54,200 + BRL 412.50.
		martin: {
			id: "martin",
			onRetrospend: true,
			records: [
				share("Pizza night", "2026-10-08", null, "ARS", -1_800_000),
				share("Electricidad", "2026-10-14", DEPTO, "ARS", 1_560_000),
				finalRow("pm-martin-1", "2026-10-16", DEPTO, "ARS", 1_560_000, "them"),
				share("Arreglo del calefón", "2026-10-20", DEPTO, "ARS", -3_620_000),
				share("Car", "2026-10-09", FLORIPA, "BRL", -30_000),
				share("Stay", "2026-10-10", FLORIPA, "BRL", 20_000),
				share("Dinner", "2026-10-12", FLORIPA, "BRL", -20_000),
				share("Last night", "2026-10-17", FLORIPA, "BRL", -11_250),
			],
		},
		// Example C: Lucía owes ARS 168,500 + BRL 612.40, and claims ARS 20,000.
		lucia: {
			id: "lucia",
			onRetrospend: true,
			records: [
				share("Cabaña en Tigre", "2026-09-05", null, "ARS", 15_000_000),
				share("Vivero", "2026-09-20", null, "ARS", 9_850_000),
				finalRow("pm-lucia-1", "2026-09-28", null, "ARS", 6_000_000, "them"),
				share("Cena en La Esquina", "2026-10-18", null, "ARS", -2_000_000),
				share("Hospedagem", "2026-10-10", FLORIPA, "BRL", 61_240),
				{
					...finalRow(
						"pm-lucia-claim",
						"2026-10-20",
						null,
						"ARS",
						2_000_000,
						"them",
					),
					status: "PROPOSED",
					confirmedByPayer: true,
					confirmedByPayee: false,
				},
			],
		},
		// Not on Retrospend: anything recorded with Paz is final at once.
		paz: {
			id: "paz",
			onRetrospend: false,
			records: [
				share("Hospedagem", "2026-10-11", FLORIPA, "BRL", 41_250),
				share("Churrasco de despedida", "2026-10-16", null, "ARS", 8_000_000),
			],
		},
		// Example E: Valentina owes ARS 9,000; Sofía owes her BRL 128.
		valentina: {
			id: "valentina",
			onRetrospend: true,
			records: [
				share("Surf class", "2026-10-03", null, "ARS", 900_000),
				share("Boat trip", "2026-10-12", FLORIPA, "BRL", -12_800),
			],
		},
	} satisfies Record<string, FixturePerson>;
}

/** Sofía's side of a row: "from" when she paid it. */
const sofiaSide = (row: RowRecord): "from" | "to" =>
	row.from === "me" ? "from" : "to";

/** The events `viewer` sees, signed from the viewer's side. */
export function eventsFor(person: FixturePerson, viewer: Who): PairEvent[] {
	const sign = viewer === "me" ? 1 : -1;
	const events: PairEvent[] = [];
	for (const r of person.records) {
		if (r.kind === "share") {
			events.push({
				date: r.date,
				scope: r.scope,
				currency: r.currency,
				minor: sign * r.minor,
				kind: "share",
			});
			continue;
		}
		const mySide = sofiaSide(r);
		const side = viewer === "me" ? mySide : mySide === "from" ? "to" : "from";
		if (!countsFor(r, side)) continue;
		// A row from Sofía raises what they owe her.
		const fromMe = r.from === "me" ? 1 : -1;
		events.push({
			date: r.date,
			scope: r.scope,
			currency: r.currency,
			minor: sign * fromMe * r.amount,
			kind: "payment",
			pending: r.status === "PROPOSED",
		});
	}
	return events;
}

export interface RecordArgs {
	readonly payer: Who;
	readonly recorder: Who;
	readonly currency: string;
	readonly amount: Minor | null;
	readonly paidOn?: IsoDate;
	readonly quotes?: ReadonlyMap<string, Quote>;
	readonly applyTo?: readonly ApplyTo[];
	readonly allowOverpay?: boolean;
}

/** Records a payment the way payment.record does, from the recorder's view. */
export function recordPayment(
	person: FixturePerson,
	args: RecordArgs,
	paymentId = `pm-${person.id}-${person.records.length}`,
): Allocation {
	const lines = ledgerLines(eventsFor(person, args.recorder));
	const allocation = allocatePayment({
		lines: payerLines(lines, args.payer === args.recorder),
		currency: args.currency,
		amount: args.amount,
		quotes: args.quotes ?? BLUE,
		applyTo: args.applyTo,
		allowOverpay: args.allowOverpay,
	});
	if (allocation.overpay > 0 && !args.allowOverpay) return allocation;
	const payeeIsUser = args.payer === "them" || person.onRetrospend;
	const confirmation = confirmationFor(
		args.recorder !== args.payer,
		payeeIsUser ? "user" : "shadow",
	);
	for (const planned of plannedSettlements(allocation)) {
		const payerRow = planned.from === "payer";
		const from: Who = payerRow
			? args.payer
			: args.payer === "me"
				? "them"
				: "me";
		const flags = payerRow
			? confirmation
			: { ...confirmation, ...swappedFlags(confirmation) };
		person.records.push({
			kind: "row",
			paymentId,
			date: args.paidOn ?? TODAY,
			scope: planned.scope,
			currency: planned.currency,
			amount: planned.amount,
			from,
			status: confirmation.status,
			confirmedByPayer: flags.confirmedByPayer,
			confirmedByPayee: flags.confirmedByPayee,
			isOffset: planned.isOffset,
			paid: planned.paid,
		});
	}
	return allocation;
}

/** The receiver confirms: every row of the payment turns final. */
export function confirmPayment(person: FixturePerson, paymentId: string): void {
	for (const r of person.records) {
		if (r.kind !== "row" || r.paymentId !== paymentId) continue;
		r.status = "FINALIZED";
		r.confirmedByPayer = true;
		r.confirmedByPayee = true;
	}
}

export function rowsOf(person: FixturePerson, paymentId: string): RowRecord[] {
	return person.records.filter(
		(r): r is RowRecord => r.kind === "row" && r.paymentId === paymentId,
	);
}
