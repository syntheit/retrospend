import {
	filterLedger,
	groupByMonth,
	type LedgerChip,
	mergeLedger,
} from "./ledger";
import type { PersonPage } from "./source";

type Row = PersonPage["rows"][number];
type Payment = PersonPage["payments"][number];

function row(id: string, date: string, over: Partial<Row> = {}): Row {
	return {
		id,
		title: id,
		date,
		amount: { minor: 1000, currency: "ARS" },
		category: null,
		project: null,
		paidBy: "me",
		payerName: "You",
		payerId: "user:me",
		people: [],
		effect: { minor: 500, currency: "ARS" },
		state: "ok",
		canEdit: true,
		...over,
	};
}

function payment(id: string, paidOn: string, over: Partial<Payment> = {}) {
	return {
		id,
		rowId: null,
		direction: "in",
		amount: { minor: 500, currency: "ARS" },
		paidOn,
		method: "Transfer",
		status: "final",
		recordedByMe: true,
		parts: [],
		...over,
	} as Payment;
}

describe("mergeLedger", () => {
	it("puts expenses and payments in one list, newest first, a payment first on a shared day", () => {
		const items = mergeLedger(
			[row("a", "2026-10-05"), row("b", "2026-09-30")],
			[payment("p", "2026-10-05"), payment("q", "2026-10-01")],
			true,
		);
		expect(items.map((i) => i.id)).toEqual(["p", "a", "q", "b"]);
	});

	it("leaves out payments older than the oldest loaded expense until all are loaded", () => {
		const rows = [row("a", "2026-10-05")];
		const payments = [payment("old", "2026-08-01")];
		expect(mergeLedger(rows, payments, false).map((i) => i.id)).toEqual(["a"]);
		expect(mergeLedger(rows, payments, true).map((i) => i.id)).toEqual([
			"a",
			"old",
		]);
	});
});

describe("filterLedger", () => {
	const items = mergeLedger(
		[
			row("lunch", "2026-10-05", { paidBy: "them" }),
			row("rent", "2026-10-02", { state: "review" }),
			row("old", "2026-09-02", { effect: null, state: "settled" }),
		],
		[payment("p", "2026-10-03", { status: "pending", direction: "out" })],
		true,
	);
	const on = (...chips: LedgerChip[]) => new Set(chips);

	it("keeps outstanding expenses and pending payments", () => {
		expect(filterLedger(items, on("outstanding"), "").map((i) => i.id)).toEqual(
			["lunch", "p", "rent"],
		);
	});

	it("keeps only payments, or only what waits for you", () => {
		expect(filterLedger(items, on("payments"), "").map((i) => i.id)).toEqual([
			"p",
		]);
		expect(filterLedger(items, on("review"), "").map((i) => i.id)).toEqual([
			"rent",
		]);
	});

	it("tells who paid, and applies every chip that is on", () => {
		expect(filterLedger(items, on("paidByThem"), "").map((i) => i.id)).toEqual([
			"lunch",
		]);
		expect(
			filterLedger(items, on("paidByMe", "outstanding"), "").map((i) => i.id),
		).toEqual(["p", "rent"]);
	});

	it("searches titles without caring for case", () => {
		expect(filterLedger(items, on(), "RENT").map((i) => i.id)).toEqual([
			"rent",
		]);
	});
});

describe("groupByMonth", () => {
	it("groups consecutive lines by their month", () => {
		const items = mergeLedger(
			[row("a", "2026-10-05"), row("b", "2026-10-01"), row("c", "2026-09-15")],
			[],
			true,
		);
		expect(
			groupByMonth(items).map((g) => [g.month, g.items.map((i) => i.id)]),
		).toEqual([
			["2026-10", ["a", "b"]],
			["2026-09", ["c"]],
		]);
	});
});
