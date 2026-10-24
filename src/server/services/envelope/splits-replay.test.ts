import { describe, expect, it } from "vitest";
import {
	type ReplayEvent,
	type ReplayResult,
	replaySplits,
	type SettlementStatus,
	type ShareStatus,
	splitsTotals,
} from "./splits-replay";

/** ARS amounts in minor units (2 decimals). */
const ars = (n: number) => Math.round(n * 100);

let seq = 0;
const base = (who: string, currency: string, native: number, date: string) => ({
	id: `e${String(++seq).padStart(3, "0")}`,
	counterparty: who,
	currency,
	native,
	date,
	month: Number(date.slice(0, 4) + date.slice(5, 7)),
});

const front = (
	who: string,
	native: number,
	value: number,
	date = "2026-10-01",
	currency = "ARS",
): ReplayEvent => ({
	...base(who, currency, native, date),
	kind: "FRONT",
	value,
});
const owe = (
	who: string,
	native: number,
	status: ShareStatus = "ACCEPTED",
	date = "2026-10-02",
	currency = "ARS",
): ReplayEvent => ({
	...base(who, currency, native, date),
	kind: "OWE",
	status,
});
const unfront = (
	who: string,
	native: number,
	date = "2026-10-20",
): ReplayEvent => ({ ...base(who, "ARS", native, date), kind: "UNFRONT" });
const recv = (
	who: string,
	native: number,
	cash: number,
	o: {
		status?: SettlementStatus;
		date?: string;
		currency?: string;
		isOffset?: boolean;
	} = {},
): ReplayEvent => ({
	...base(who, o.currency ?? "ARS", native, o.date ?? "2026-10-08"),
	kind: "RECV",
	status: o.status ?? "FINALIZED",
	cash,
	isOffset: o.isOffset,
});
const pay = (
	who: string,
	native: number,
	cash: number,
	o: { status?: SettlementStatus; date?: string; currency?: string } = {},
): ReplayEvent => ({
	...base(who, o.currency ?? "ARS", native, o.date ?? "2026-10-09"),
	kind: "PAY",
	status: o.status ?? "FINALIZED",
	cash,
});
const forgive = (
	who: string,
	native: number,
	envelopeId: string,
	date = "2026-10-20",
): ReplayEvent => ({
	...base(who, "ARS", native, date),
	kind: "FORGIVE",
	status: "FINALIZED",
	envelopeId,
});

/** The replay's own invariant, per counterparty and currency: SplitsNet = basis held - FX notes. */
function expectReplayInvariant(r: ReplayResult) {
	for (const b of r.balances) {
		const mine = r.effects.filter(
			(e) => e.counterparty === b.counterparty && e.currency === b.currency,
		);
		const t = splitsTotals(mine);
		expect(t.net, `${b.counterparty} ${b.currency}`).toBe(b.basis - t.fx);
		if (b.native <= 0) expect(b.basis).toBe(0);
	}
}

interface Row {
	name: string;
	events: ReplayEvent[];
	net: number;
	fronted?: number;
	returned?: number;
	forgiven?: number;
	fx?: number;
	balances?: Array<{ counterparty: string; currency?: string; native: number }>;
}

const rows: Row[] = [
	{
		name: "S5 asado: ARS 90,000 for three, Juan pays back 30,000",
		events: [
			front("juan", ars(30_000), ars(30_000)),
			front("paz", ars(30_000), ars(30_000)),
			recv("juan", ars(30_000), ars(30_000)),
		],
		fronted: ars(60_000),
		returned: ars(30_000),
		net: ars(30_000),
		balances: [
			{ counterparty: "juan", native: 0 },
			{ counterparty: "paz", native: ars(30_000) },
		],
	},
	{
		name: "C12 partial settlement: Juan pays 15,000 of 30,000",
		events: [
			front("juan", ars(30_000), ars(30_000)),
			recv("juan", ars(15_000), ars(15_000)),
		],
		returned: ars(15_000),
		net: ars(15_000),
		balances: [{ counterparty: "juan", native: ars(15_000) }],
	},
	{
		name: "over-payment of 50 leaves To assign unchanged and shows you owe 50",
		events: [
			front("juan", ars(100), ars(100)),
			recv("juan", ars(150), ars(150)),
		],
		returned: ars(100),
		net: 0,
		balances: [{ counterparty: "juan", native: -ars(50) }],
	},
	{
		name: "mutual fronting of 100 each way nets to 0 held",
		events: [front("sam", ars(100), ars(100)), owe("sam", ars(100))],
		fronted: ars(100),
		returned: ars(100),
		net: 0,
		balances: [{ counterparty: "sam", native: 0 }],
	},
	{
		name: "fronting while you owe them first pays your debt (no budget effect)",
		events: [
			owe("sam", ars(100), "ACCEPTED", "2026-10-01"),
			front("sam", ars(100), ars(100), "2026-10-03"),
		],
		fronted: 0,
		net: 0,
		balances: [{ counterparty: "sam", native: 0 }],
	},
	{
		name: "D8 S11 a PROPOSED payment to you is pending, not counted",
		events: [
			front("paz", ars(30_000), ars(30_000)),
			recv("paz", ars(30_000), ars(30_000), { status: "PROPOSED" }),
		],
		net: ars(30_000),
		balances: [{ counterparty: "paz", native: ars(30_000) }],
	},
	{
		name: "D20 S25 your REJECTED share does not net against what they owe you",
		events: [
			front("sam", ars(150), ars(150)),
			owe("sam", ars(150), "REJECTED"),
		],
		net: ars(150),
		balances: [{ counterparty: "sam", native: ars(150) }],
	},
	{
		name: "D20 your PENDING share counts like an accepted one",
		events: [front("sam", ars(150), ars(150)), owe("sam", ars(150), "PENDING")],
		net: 0,
	},
	{
		name: "others' REJECTED share on a split you paid is still fronted (the cash left)",
		events: [
			{
				...front("sam", ars(150), ars(150)),
				shareStatus: "REJECTED",
			} as ReplayEvent,
		],
		fronted: ars(150),
		net: ars(150),
	},
	{
		name: "D10 USD fronted at 1,400, repaid at 1,465: cash value returns, FX note +5,525",
		events: [
			front("clara", 8_500, ars(119_000), "2026-09-10", "USD"),
			recv("clara", 8_500, ars(124_525), {
				currency: "USD",
				date: "2026-10-10",
			}),
		],
		fronted: ars(119_000),
		returned: ars(124_525),
		fx: ars(5_525),
		net: -ars(5_525),
		balances: [{ counterparty: "clara", currency: "USD", native: 0 }],
	},
	{
		name: "S6 CLP vs USD with an offset: the USD receivable releases at basis",
		events: [
			owe("nico", 120_000, "ACCEPTED", "2026-10-05", "CLP"),
			front("nico", 8_500, ars(119_000), "2026-10-06", "USD"),
			recv("nico", 8_500, 0, {
				currency: "USD",
				isOffset: true,
				date: "2026-10-20",
			}),
			pay("nico", 120_000, ars(65_925), {
				currency: "CLP",
				date: "2026-10-20",
			}),
		],
		fronted: ars(119_000),
		returned: ars(119_000),
		net: 0,
		balances: [
			{ counterparty: "nico", currency: "CLP", native: 0 },
			{ counterparty: "nico", currency: "USD", native: 0 },
		],
	},
	{
		name: "S18 guest BRL split paid back in ARS: paying a debt never reaches the budget",
		events: [
			owe("mateo", 40_000, "AUTO_ACCEPTED", "2026-10-11", "BRL"),
			pay("mateo", 40_000, ars(108_000), {
				currency: "BRL",
				date: "2026-10-12",
			}),
		],
		net: 0,
		fronted: 0,
		returned: 0,
		balances: [{ counterparty: "mateo", currency: "BRL", native: 0 }],
	},
	{
		name: "paying more than you owe makes a receivable; its cash value leaves To assign",
		events: [owe("sam", ars(100)), pay("sam", ars(150), ars(150))],
		fronted: ars(50),
		net: ars(50),
		balances: [{ counterparty: "sam", native: ars(50) }],
	},
	{
		name: "D11 a project routed Not in budget is dropped from the replay",
		events: [
			{
				...front("lucia", ars(500), ars(500)),
				notInBudget: true,
			} as ReplayEvent,
		],
		net: 0,
		balances: [],
	},
	{
		name: "S17 delete a settled duplicate, KEEP_CREDIT: Clara keeps a credit, budget unchanged",
		events: [
			front("clara", 120_000, ars(65_000), "2026-10-01", "CLP"),
			recv("clara", 120_000, ars(65_000), { currency: "CLP" }),
			recv("clara", 120_000, ars(65_000), {
				currency: "CLP",
				date: "2026-10-09",
			}),
		],
		net: 0,
		balances: [{ counterparty: "clara", currency: "CLP", native: -120_000 }],
	},
	{
		name: "S17 delete a settled duplicate, VOID_PAYMENT: nothing left either way",
		events: [
			front("clara", 120_000, ars(65_000), "2026-10-01", "CLP"),
			recv("clara", 120_000, ars(65_000), { currency: "CLP" }),
		],
		net: 0,
		balances: [{ counterparty: "clara", currency: "CLP", native: 0 }],
	},
	{
		name: "C8 for someone else: the whole USD 800 is fronted until Work repays",
		events: [front("work", 80_000, ars(1_120_000), "2026-10-03", "USD")],
		fronted: ars(1_120_000),
		net: ars(1_120_000),
	},
	{
		name: "C8 for someone else, repaid: the cash value returns",
		events: [
			front("work", 80_000, ars(1_120_000), "2026-10-03", "USD"),
			recv("work", 80_000, ars(1_120_000), { currency: "USD" }),
		],
		net: 0,
	},
	{
		name: "C14 forgive Paz's 30,000 into Dining: To assign +30,000, Dining charged",
		events: [
			front("paz", ars(30_000), ars(30_000)),
			forgive("paz", ars(30_000), "dining"),
		],
		forgiven: ars(30_000),
		net: 0,
		balances: [{ counterparty: "paz", native: 0 }],
	},
	{
		name: "2C.2 a correction lowers Sofia's share by 1,000 of the 15,000 you fronted: 1,000 returns",
		events: [
			front("sofia", ars(15_000), ars(15_000)),
			unfront("sofia", ars(1_000)),
		],
		fronted: ars(15_000),
		returned: ars(1_000),
		net: ars(14_000),
		balances: [{ counterparty: "sofia", native: ars(14_000) }],
	},
	{
		name: "2C.2 a correction after Sofia paid in full: nothing returns, you owe her 1,000",
		events: [
			front("sofia", ars(15_000), ars(15_000)),
			recv("sofia", ars(15_000), ars(15_000)),
			unfront("sofia", ars(1_000)),
		],
		fronted: ars(15_000),
		returned: ars(15_000),
		net: 0,
		balances: [{ counterparty: "sofia", native: -ars(1_000) }],
	},
	{
		name: "2C.2 wrong payer: Sofia paid and you owed 15,000; the correction says you paid, she owes 15,000",
		events: [
			owe("sofia", ars(15_000), "ACCEPTED", "2026-10-01"),
			front("sofia", ars(15_000), ars(15_000), "2026-10-20"),
			front("sofia", ars(15_000), ars(15_000), "2026-10-20"),
		],
		fronted: ars(15_000),
		net: ars(15_000),
		balances: [{ counterparty: "sofia", native: ars(15_000) }],
	},
	{
		name: "2C.2 your own share fell after you paid Sofia 15,000: she owes you the 5,000 back, held",
		events: [
			owe("sofia", ars(15_000), "ACCEPTED", "2026-10-01"),
			pay("sofia", ars(15_000), ars(15_000), { date: "2026-10-05" }),
			front("sofia", ars(5_000), ars(5_000), "2026-10-20"),
		],
		fronted: ars(5_000),
		net: ars(5_000),
		balances: [{ counterparty: "sofia", native: ars(5_000) }],
	},
];

describe("replaySplits", () => {
	it.each(rows)("$name", (row) => {
		const r = replaySplits(row.events);
		const t = splitsTotals(r.effects);
		expect(t.net).toBe(row.net);
		if (row.fronted !== undefined) expect(t.fronted).toBe(row.fronted);
		if (row.returned !== undefined) expect(t.returned).toBe(row.returned);
		if (row.forgiven !== undefined) expect(t.forgiven).toBe(row.forgiven);
		if (row.fx !== undefined) expect(t.fx).toBe(row.fx);
		if (row.balances) {
			expect(
				r.balances.map((b) => ({
					counterparty: b.counterparty,
					currency: b.currency,
					native: b.native,
				})),
			).toEqual(row.balances.map((b) => ({ currency: "ARS", ...b })));
		}
		expectReplayInvariant(r);
	});

	it("C14 the forgive effect names the envelope it charges", () => {
		const r = replaySplits([
			front("paz", ars(30_000), ars(30_000)),
			forgive("paz", ars(30_000), "dining"),
		]);
		expect(r.effects.find((e) => e.term === "FORGIVEN")).toMatchObject({
			envelopeId: "dining",
			minor: ars(30_000),
		});
	});

	it("forgiving more than is owed clears the balance and reports the excess", () => {
		const r = replaySplits([
			front("paz", ars(100), ars(100)),
			forgive("paz", ars(150), "dining"),
		]);
		expect(splitsTotals(r.effects).forgiven).toBe(ars(100));
		expect(r.ignored).toContainEqual(
			expect.objectContaining({
				reason: "FORGIVE_EXCEEDS_BALANCE",
				native: ars(50),
			}),
		);
	});

	it("a partial repayment releases basis pro rata, the last part takes the remainder", () => {
		const r = replaySplits([
			front("clara", 300, 1_000, "2026-10-01", "USD"),
			recv("clara", 100, 333, { currency: "USD", date: "2026-10-02" }),
			recv("clara", 100, 333, { currency: "USD", date: "2026-10-03" }),
			recv("clara", 100, 334, { currency: "USD", date: "2026-10-04" }),
		]);
		expect(
			r.effects.filter((e) => e.term === "RETURNED").map((e) => e.minor - e.fx),
		).toEqual([333, 334, 333]);
		expect(r.balances[0]).toMatchObject({ native: 0, basis: 0 });
		expectReplayInvariant(r);
	});

	it("SplitsNet(<= m) counts only events up to that month (S11 October to November)", () => {
		const r = replaySplits([
			front("juan", ars(30_000), ars(30_000), "2026-10-20"),
			recv("juan", ars(30_000), ars(30_000), { date: "2026-11-03" }),
		]);
		expect(splitsTotals(r.effects, 202610).net).toBe(ars(30_000));
		expect(splitsTotals(r.effects, 202611).net).toBe(0);
	});

	it("events replay in (date, id) order whatever the input order", () => {
		const a = front("sam", ars(100), ars(100), "2026-10-01");
		const b = recv("sam", ars(100), ars(100), { date: "2026-10-05" });
		expect(replaySplits([b, a]).effects).toEqual(replaySplits([a, b]).effects);
	});

	it("on one day, the split comes before the payment that settles it, whatever their ids", () => {
		const a = {
			...front("sam", ars(100), ars(100), "2026-10-05"),
			id: "z-split",
		};
		const b = {
			...recv("sam", ars(100), ars(100), { date: "2026-10-05" }),
			id: "a-pay",
		};
		const r = replaySplits([b, a]);
		expect(r.effects.map((e) => [e.eventId, e.term])).toEqual([
			["z-split", "FRONTED"],
			["a-pay", "RETURNED"],
		]);
		expect(r.balances[0]?.native).toBe(0);
	});

	it("a forgive of your debt larger than the debt clears it and drops the rest (nothing owed back)", () => {
		const owe = {
			kind: "OWE" as const,
			id: "o1",
			counterparty: "sam",
			currency: "ARS",
			date: "2026-10-01",
			month: 202610,
			native: ars(100),
			status: "ACCEPTED" as const,
		};
		const fg = {
			kind: "PAY" as const,
			id: "fg",
			counterparty: "sam",
			currency: "ARS",
			date: "2026-10-05",
			month: 202610,
			native: ars(150),
			status: "FINALIZED" as const,
			cash: 0,
			isOffset: true,
			forgiven: true,
		};
		const r = replaySplits([owe, fg]);
		expect(r.balances[0]?.native).toBe(0);
		expect(r.effects).toEqual([]);
		expect(r.ignored).toContainEqual({
			eventId: "fg",
			reason: "FORGIVE_EXCEEDS_BALANCE",
			native: ars(50),
		});
	});

	it("rejects non-positive or fractional native amounts", () => {
		expect(() => replaySplits([front("sam", 0, 0)])).toThrow(RangeError);
		expect(() => replaySplits([front("sam", 1.5, 2)])).toThrow(RangeError);
	});
});
