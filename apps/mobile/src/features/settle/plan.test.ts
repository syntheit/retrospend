import type { SettleContext } from "@/features/people/source";
import {
	allocationOf,
	type PaymentPreview,
	previewRows,
	recordInput,
} from "./plan";

const ref = { type: "user", id: "lucia" } as const;

// What GET /people/user/lucia/settle answered for the e2e seed.
const context: SettleContext = {
	home: "ARS",
	currency: "ARS",
	currencies: ["ARS", "BRL"],
	direction: "incoming",
	suggested: "incoming",
	lines: [],
	everything: { minor: 30518100, currency: "ARS" },
	parts: [
		{ currency: "ARS", full: { minor: 16230000, currency: "ARS" } },
		{ currency: "BRL", full: { minor: 14288100, currency: "ARS" } },
	],
	rates: [],
	rateTypes: ["official"],
	unpriced: [],
	today: "2026-10-25",
	yesterday: "2026-10-24",
};

describe("recordInput", () => {
	it("pays everything with no amount and no scope", () => {
		expect(
			recordInput(ref, context, "incoming", { kind: "everything" }, "id1"),
		).toEqual({
			id: "id1",
			person: ref,
			direction: "incoming",
			currency: "ARS",
			amount: null,
		});
	});

	it("pays one currency's part as decimal text, applied to that currency", () => {
		expect(
			recordInput(
				ref,
				context,
				"outgoing",
				{ kind: "part", currency: "BRL" },
				"id2",
			),
		).toEqual({
			id: "id2",
			person: ref,
			direction: "outgoing",
			currency: "ARS",
			amount: "142881.00",
			applyTo: [{ currency: "BRL" }],
		});
	});

	it("refuses a part the server did not offer", () => {
		expect(() =>
			recordInput(
				ref,
				context,
				"incoming",
				{ kind: "part", currency: "USD" },
				"id3",
			),
		).toThrow(RangeError);
	});
});

describe("previewRows", () => {
	const preview: PaymentPreview = {
		changes: [
			{
				id: "balance.person",
				currency: "ARS",
				before: { minor: 16230000, currency: "ARS" },
				after: null,
				delta: { minor: -16230000, currency: "ARS" },
				figureAfter: [],
			},
			{
				id: "owed.owedToYou",
				currency: "ARS",
				before: { minor: 125211608, currency: "ARS" },
				after: { minor: 94693469, currency: "ARS" },
				delta: { minor: -30518139, currency: "ARS" },
				figureAfter: [{ minor: 94693469, currency: "ARS" }],
			},
			{
				id: "budget.other",
				currency: "ARS",
				before: null,
				after: null,
				delta: { minor: 0, currency: "ARS" },
				figureAfter: [],
			},
		],
		unchanged: [
			{ id: "owed.youOwe", lines: [{ minor: 1796981, currency: "ARS" }] },
		],
		unavailable: [],
	};

	it("keeps the figures the sheet words, in the server's order", () => {
		const { changes, kept } = previewRows(preview);
		expect(
			changes.map((c) => [c.figure, c.before?.minor, c.after?.minor]),
		).toEqual([
			["balance.person", 16230000, undefined],
			["owed.owedToYou", 125211608, 94693469],
		]);
		expect(kept).toEqual([
			{ figure: "owed.youOwe", lines: [{ minor: 1796981, currency: "ARS" }] },
		]);
	});

	it("reads the amount the allocation pays", () => {
		expect(allocationOf(preview)).toBeNull();
		const detail = (rows: { rate: unknown }[]) => ({
			...preview,
			detail: {
				kind: "payment.record",
				allocation: {
					amount: { minor: 30518100, currency: "ARS" },
					rows,
				},
			},
		});
		expect(allocationOf(detail([{ rate: null }]))).toEqual({
			amount: { minor: 30518100, currency: "ARS" },
			converted: false,
		});
		// A BRL debt paid in ARS went through a rate: an estimate.
		expect(
			allocationOf(detail([{ rate: null }, { rate: { rateType: "official" } }]))
				?.converted,
		).toBe(true);
	});
});
