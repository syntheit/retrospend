/**
 * Split rows to replay events (split-events.ts): which row is which event,
 * when a payment counts (D8, I5), how cash is valued (D10), and that
 * calendar dates are read as stored (SPEC §5.1, C21). Values by hand.
 */
import { describe, expect, it } from "vitest";
import {
	front,
	mine,
	settlement,
	TABLE,
	type TxSpec,
} from "./__tests__/split-rows";
import { Valuer } from "./entries";
import { type SplitRows, splitEvents } from "./split-events";
import { bookContext, lookupIn } from "./test-fixtures";

const table = lookupIn(TABLE);

function events(rows: Partial<SplitRows>, tz = "UTC") {
	const valuer = new Valuer(
		bookContext("ARS", {
			usdRate: table,
			defaultRateType: "blue",
			periods: [{ fromMonth: 202601, startDay: 1, rateType: "blue" }],
		}),
		tz,
		[{ fromMonth: 202601, startDay: 1 }],
	);
	const out = splitEvents(
		{ fronts: [], mine: [], settlements: [], ...rows },
		{
			valuer,
			key: (r) => `${r.participantType}:${r.participantId}`,
			me: "user:me",
			notInBudget: new Set(["hidden"]),
			rate: (row) =>
				table(
					row.currency,
					"official",
					row.date.toISOString().slice(0, 10),
				)?.toString() ?? null,
		},
	);
	return { ...out, missing: valuer.missingRates };
}

const paidByMe: TxSpec = {
	id: "t1",
	currency: "USD",
	date: "2026-10-05",
	paidBy: "user:me",
};
const paidBySam: TxSpec = { ...paidByMe, id: "t2", paidBy: "user:sam" };

describe("split rows to replay events", () => {
	it("someone's share of a split you paid is fronted at its booked value, rejected ones too", () => {
		const { events: e } = events({
			fronts: [front("f1", "user:sam", paidByMe, "50", "REJECTED")],
		});
		// USD 50 at blue 1,465 = ARS 73,250.
		expect(e).toEqual([
			expect.objectContaining({
				kind: "FRONT",
				counterparty: "user:sam",
				currency: "USD",
				native: 5_000,
				value: 7_325_000,
				month: 202610,
				shareStatus: "REJECTED",
			}),
		]);
	});

	it("your share of a split someone else paid is owed to the payer; your share of your own split is nothing", () => {
		const { events: e } = events({
			mine: [mine("m1", paidBySam, "30"), mine("m2", paidByMe, "30")],
		});
		expect(e).toEqual([
			expect.objectContaining({
				kind: "OWE",
				id: "m1",
				counterparty: "user:sam",
				native: 3_000,
				status: "ACCEPTED",
			}),
		]);
	});

	it("a payment to you counts once FINALIZED, at the cash received (USD 40 for a CLP debt)", () => {
		const { events: e } = events({
			settlements: [
				settlement(
					"p1",
					"user:clara",
					"user:me",
					"38400",
					"CLP",
					"2026-10-20",
					{
						converted: ["40", "USD"],
					},
				),
			],
		});
		expect(e).toEqual([
			expect.objectContaining({
				kind: "RECV",
				counterparty: "user:clara",
				currency: "CLP",
				native: 38_400,
				cash: 5_860_000,
				status: "FINALIZED",
			}),
		]);
	});

	it("a payment to you not yet confirmed is pending: shown with its value, not an event (D8)", () => {
		const r = events({
			settlements: [
				settlement("p1", "user:juan", "user:me", "100", "USD", "2026-10-20", {
					status: "PROPOSED",
					confirmedByPayee: false,
				}),
			],
		});
		expect(r.events).toEqual([]);
		expect(r.pending).toEqual([
			{
				id: "p1",
				counterparty: "user:juan",
				currency: "USD",
				native: 10_000,
				cash: 14_650_000,
				date: "2026-10-20",
			},
		]);
	});

	it("a payment from you counts when you recorded or confirmed it; one they claim you made does not (I5)", () => {
		const { events: e } = events({
			settlements: [
				settlement("mine", "user:me", "user:sam", "10", "USD", "2026-10-20", {
					status: "PROPOSED",
					confirmedByPayer: true,
					confirmedByPayee: false,
				}),
				settlement("claim", "user:me", "user:sam", "20", "USD", "2026-10-20", {
					status: "PROPOSED",
					confirmedByPayer: false,
				}),
			],
		});
		expect(e.map((x) => [x.id, x.kind])).toEqual([["mine", "PAY"]]);
	});

	it("a forgive of what they owe you names its envelope; one of what you owe clears your debt with no cash", () => {
		const { events: e } = events({
			settlements: [
				settlement("fg1", "user:paz", "user:me", "30", "USD", "2026-10-20", {
					kind: "FORGIVE",
					forgiveEnvelopeId: "dining",
				}),
				settlement("fg2", "user:me", "user:sam", "15", "USD", "2026-10-20", {
					kind: "FORGIVE",
				}),
			],
		});
		expect(e).toEqual([
			expect.objectContaining({
				id: "fg1",
				kind: "FORGIVE",
				envelopeId: "dining",
			}),
			expect.objectContaining({
				id: "fg2",
				kind: "PAY",
				cash: 0,
				isOffset: true,
			}),
		]);
	});

	it("the payment's day is its calendar date, never moved by the book's zone (C21)", () => {
		const s = settlement(
			"p1",
			"user:juan",
			"user:me",
			"10",
			"USD",
			"2026-11-01",
		);
		const { events: e } = events(
			{ settlements: [s] },
			"America/Argentina/Buenos_Aires",
		);
		expect(e[0]).toMatchObject({ date: "2026-11-01", month: 202611 });
	});

	it("rows in a project you count Not in budget are flagged for the replay to list", () => {
		const { events: e } = events({
			fronts: [
				front("f1", "user:sam", { ...paidByMe, projectId: "hidden" }, "10"),
			],
		});
		expect(e[0]).toMatchObject({ notInBudget: true });
	});

	it("a share in a currency with no rate is left out and listed, never valued at 1 (C18)", () => {
		const r = events({
			fronts: [
				front("f1", "user:sam", { ...paidByMe, currency: "XAF" }, "1000"),
			],
		});
		expect(r.events).toEqual([]);
		expect(r.missing).toEqual([
			expect.objectContaining({ currency: "XAF", rowId: "f1" }),
		]);
	});

	it("rejected payments and rows between two other people are ignored", () => {
		const { events: e } = events({
			settlements: [
				settlement("r1", "user:sam", "user:me", "10", "USD", "2026-10-20", {
					status: "REJECTED",
				}),
				settlement("o1", "user:sam", "user:paz", "10", "USD", "2026-10-20"),
			],
		});
		expect(e).toEqual([]);
	});
});
