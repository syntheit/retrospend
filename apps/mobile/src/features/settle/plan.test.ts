import type { SettleContext } from "@/features/people/source";
import {
	type Allocation,
	allocationDetail,
	answerFor,
	balanceAfter,
	chipRate,
	everythingConverts,
	fillOf,
	isOverpay,
	owedBreakdown,
	type PaymentPreview,
	previewRows,
	rateChoices,
	recordInput,
	startMethod,
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

	it("sends a typed amount as decimal text with no scope", () => {
		// ARS has 2 decimals: 25050 minor is "250.50".
		expect(
			recordInput(
				ref,
				context,
				"outgoing",
				{ kind: "custom", minor: 25050 },
				"id4",
			),
		).toEqual({
			id: "id4",
			person: ref,
			direction: "outgoing",
			currency: "ARS",
			amount: "250.50",
		});
	});

	it("has no request for an amount that is not typed yet", () => {
		expect(
			recordInput(ref, context, "outgoing", { kind: "custom", minor: 0 }, "x"),
		).toBeNull();
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
				approx: true,
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
			{
				id: "owed.youOwe",
				lines: [{ minor: 1796981, currency: "ARS" }],
				approx: true,
			},
		],
		unavailable: [],
	};

	it("keeps the figures the sheet words, in the server's order", () => {
		const { changes, kept } = previewRows(preview);
		expect(
			changes.map((c) => [c.figure, c.before?.minor, c.after?.minor, c.approx]),
		).toEqual([
			["balance.person", 16230000, undefined, false],
			["owed.owedToYou", 125211608, 94693469, true],
		]);
		expect(kept).toEqual([
			{
				figure: "owed.youOwe",
				lines: [{ minor: 1796981, currency: "ARS" }],
				approx: true,
			},
		]);
	});

});

describe("answerFor", () => {
	const answer = { key: "a", preview: "p" };

	it("shows a dry run only for the request it answered", () => {
		expect(answerFor(answer, "a")).toBe(answer);
		expect(answerFor(answer, "b")).toBeNull();
		expect(answerFor(answer, null)).toBeNull();
		expect(answerFor(null, "a")).toBeNull();
	});
});

describe("isOverpay", () => {
	it("knows the server's problem for more than is owed", () => {
		expect(isOverpay({ code: "overpay", status: 422 })).toBe(true);
		expect(isOverpay({ code: "bad_request", status: 400 })).toBe(false);
		expect(isOverpay(new Error("offline"))).toBe(false);
		expect(isOverpay(null)).toBe(false);
	});
});

const ars = (minor: number) => ({ minor, currency: "ARS" });
const brl = (minor: number) => ({ minor, currency: "BRL" });

describe("recordInput details", () => {
	it("sends the rate type, the method and the day the person picked", () => {
		expect(
			recordInput(ref, context, "outgoing", { kind: "everything" }, "id5", {
				rateType: "blue",
				paymentMethod: "cash",
				paidOn: "2026-10-24",
			}),
		).toEqual({
			id: "id5",
			person: ref,
			direction: "outgoing",
			currency: "ARS",
			amount: null,
			rateType: "blue",
			paymentMethod: "cash",
			paidOn: "2026-10-24",
		});
	});

	it("leaves out what was not picked, so the server's defaults stand", () => {
		const body = recordInput(
			ref,
			context,
			"outgoing",
			{ kind: "everything" },
			"id6",
			{ rateType: null, paymentMethod: null, paidOn: null },
		);
		expect(body).not.toHaveProperty("rateType");
		expect(body).not.toHaveProperty("paymentMethod");
		expect(body).not.toHaveProperty("paidOn");
	});
});

describe("the owe line", () => {
	const owing: SettleContext = {
		...context,
		direction: "outgoing",
		lines: [
			{ project: null, amount: ars(-5670000) },
			{ project: null, amount: brl(-42650) },
			{ project: null, amount: brl(1000) },
		],
	};

	it("lists the open lines the direction settles, as sent and without sign", () => {
		expect(owedBreakdown(owing, "outgoing")).toEqual([
			ars(5670000),
			brl(42650),
		]);
		expect(owedBreakdown(owing, "incoming")).toEqual([brl(1000)]);
	});

	it("has no breakdown for one line in the payment currency", () => {
		expect(
			owedBreakdown(
				{ ...owing, lines: [{ project: null, amount: ars(-100) }] },
				"outgoing",
			),
		).toEqual([]);
	});

	it("is an estimate only when a debt in another currency converts", () => {
		expect(everythingConverts(owing, "outgoing")).toBe(true);
		expect(everythingConverts(owing, "incoming")).toBe(true);
		expect(
			everythingConverts(
				{ ...owing, lines: [{ project: null, amount: ars(-100) }] },
				"outgoing",
			),
		).toBe(false);
	});
});

describe("rateChoices", () => {
	const rate = (type: string) => ({
		type,
		unit: brl(100),
		value: ars(27100),
		rate: "271",
	});
	const withRates: SettleContext = {
		...context,
		rates: [{ currency: "BRL", rate: rate("blue") }],
		rateTypes: ["blue", "official"],
	};
	const allocation = (rows: Allocation["rows"]): Allocation => ({
		amount: ars(100),
		full: ars(100),
		rows,
		offsets: [],
		overpay: null,
	});

	it("has no chips when nothing converts", () => {
		expect(
			rateChoices(
				withRates,
				allocation([{ pays: ars(100), paid: ars(100), excess: false }]),
				null,
			),
		).toBeNull();
		expect(rateChoices(withRates, null, null)).toBeNull();
	});

	it("names the converting currencies, the types and the rate in use", () => {
		const rows = [
			{ pays: ars(50), paid: ars(50), excess: false },
			{ pays: brl(100), paid: ars(27100), excess: false },
		];
		expect(rateChoices(withRates, allocation(rows), null)).toEqual({
			currencies: ["BRL"],
			types: ["blue", "official"],
			current: "blue",
			rates: [
				{
					currency: "BRL",
					unit: brl(100),
					value: ars(27100),
					rate: "271",
					type: "blue",
				},
			],
		});
		expect(rateChoices(withRates, allocation(rows), "official")?.current).toBe(
			"official",
		);
	});

	it("offers no choice between types when there is one", () => {
		const rows = [{ pays: brl(100), paid: ars(27100), excess: false }];
		expect(
			rateChoices({ ...withRates, rateTypes: ["blue"] }, allocation(rows), null)
				?.types,
		).toEqual([]);
	});

	it("ignores the extra above what is owed", () => {
		const rows = [{ pays: brl(100), paid: ars(27100), excess: true }];
		expect(rateChoices(withRates, allocation(rows), null)).toBeNull();
	});
});

describe("balanceAfter", () => {
	const base = { delta: ars(0), figureAfter: [] };
	const answer = (
		changes: PaymentPreview["changes"],
		unchanged: PaymentPreview["unchanged"],
	): PaymentPreview => ({ changes, unchanged, unavailable: [] });

	it("is empty when the payment settles everything", () => {
		expect(
			balanceAfter(
				answer(
					[
						{
							...base,
							id: "balance.person",
							currency: "ARS",
							before: ars(100),
							after: null,
						},
					],
					[],
				),
			),
		).toEqual([]);
	});

	it("keeps what stays open, signed from your side, per currency", () => {
		expect(
			balanceAfter(
				answer(
					[
						{
							...base,
							id: "balance.person",
							currency: "ARS",
							before: ars(-500),
							after: ars(-200),
						},
						{
							...base,
							id: "owed.youOwe",
							currency: "ARS",
							before: ars(1),
							after: ars(2),
						},
					],
					[{ id: "balance.person", lines: [brl(4000)] }],
				),
			),
		).toEqual([ars(-200), brl(4000)]);
	});
});

describe("allocationDetail", () => {
	it("reads the allocation the preview carries, or none", () => {
		const bare = {
			changes: [],
			unchanged: [],
			unavailable: [],
		} as PaymentPreview;
		expect(allocationDetail(bare)).toBeNull();
		const allocation = {
			amount: ars(1),
			full: ars(1),
			rows: [],
			offsets: [],
			overpay: null,
		};
		expect(
			allocationDetail({
				...bare,
				detail: { kind: "payment.record", allocation },
			}),
		).toEqual(allocation);
	});
});

describe("fillOf", () => {
	it("fills the field with Everything or a part, in the payment currency", () => {
		expect(fillOf(context, { kind: "everything" })).toEqual(context.everything);
		expect(fillOf(context, { kind: "part", currency: "BRL" })).toEqual({
			minor: 14288100,
			currency: "ARS",
		});
	});

	it("leaves a typed amount to the field itself", () => {
		expect(fillOf(context, { kind: "custom", minor: 500 })).toBeNull();
		expect(fillOf(context, { kind: "part", currency: "USD" })).toBeNull();
	});
});

describe("startMethod", () => {
	it("starts on the last method when it is offered again", () => {
		expect(startMethod("cash", [])).toBe("cash");
		expect(startMethod("mercado_pago", [{ type: "mercado_pago" }])).toBe(
			"mercado_pago",
		);
	});

	it("falls back to the first shared method, else none", () => {
		expect(startMethod("mercado_pago", [])).toBeNull();
		expect(startMethod(null, [{ type: "pix" }, { type: "cash" }])).toBe("pix");
		expect(startMethod(null, [])).toBeNull();
	});
});

describe("chipRate", () => {
	const read = (rate: string) => ({
		unit: { minor: 100, currency: "USD" },
		value: { minor: 100000, currency: "ARS" },
		rate,
		type: "blue",
	});
	const choices = { current: "official", rates: [read("1000")] };

	it("uses the type's own read, else the current type's rate", () => {
		expect(chipRate({ blue: read("1468") }, choices, "blue")).toEqual({
			kind: "rate",
			read: read("1468"),
		});
		expect(chipRate({}, choices, "official")).toEqual({
			kind: "rate",
			read: read("1000"),
		});
	});

	it("says none when the read failed, never a rate of 1", () => {
		expect(chipRate({ blue: null }, choices, "blue")).toEqual({ kind: "none" });
	});

	it("is pending until the read answers", () => {
		expect(chipRate({}, choices, "blue")).toEqual({ kind: "pending" });
	});
});
