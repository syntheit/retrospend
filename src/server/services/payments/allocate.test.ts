/**
 * allocatePayment against the worked examples of MONEY-MOVES §1.3 to §1.7,
 * expected values derived by hand in the doc (ARS home, BRL Blue 271).
 */
import { describe, expect, it } from "vitest";
import { allocatePayment, dustOf, quote } from "./allocate";
import { ledgerLines, payerLines } from "./ledger";
import {
	BLUE,
	DEPTO,
	eventsFor,
	FLORIPA,
	fixtureLedger,
	OFFICIAL,
} from "./test-fixtures";

/** Sofía's open debts to Martín (Example A), from her side as the payer. */
const martinLines = () =>
	payerLines(ledgerLines(eventsFor(fixtureLedger().martin, "me")), true);

const cash = (a: ReturnType<typeof allocatePayment>) =>
	a.rows.map((r) => [r.scope, r.currency, r.amount, r.paid]);

describe("allocatePayment", () => {
	it("Example A: everything in pesos pays ARS first, oldest first, then BRL at Blue", () => {
		const a = allocatePayment({
			lines: martinLines(),
			currency: "ARS",
			amount: 16_598_800,
			quotes: BLUE,
		});
		expect(a.full).toBe(16_598_800); // ARS 165,987.50, to the whole peso
		expect(cash(a)).toEqual([
			[null, "ARS", 1_800_000, 1_800_000],
			[DEPTO, "ARS", 3_620_000, 3_620_000],
			// 111,788 / 271 = 412.5018: BRL 0.0018 and ARS 0.50 are dust.
			[FLORIPA, "BRL", 41_250, 11_178_800],
		]);
		expect(a.remainder).toEqual([]);
		expect(a.overpay).toBe(0);
	});

	it("Example B: a partial ARS 40,000 stops inside Depto Palermo", () => {
		const a = allocatePayment({
			lines: martinLines(),
			currency: "ARS",
			amount: 4_000_000,
			quotes: BLUE,
		});
		expect(cash(a)).toEqual([
			[null, "ARS", 1_800_000, 1_800_000],
			[DEPTO, "ARS", 2_200_000, 2_200_000],
		]);
		expect(a.remainder).toEqual([
			{ scope: DEPTO, currency: "ARS", amount: 1_420_000 },
			{ scope: FLORIPA, currency: "BRL", amount: 41_250 },
		]);
	});

	it("Example B: Apply to Florianópolis converts ARS 40,000 into BRL 147.60", () => {
		const a = allocatePayment({
			lines: martinLines(),
			currency: "ARS",
			amount: 4_000_000,
			quotes: BLUE,
			applyTo: [{ scope: FLORIPA }],
		});
		expect(cash(a)).toEqual([[FLORIPA, "BRL", 14_760, 4_000_000]]);
		expect(a.remainder).toEqual([
			{ scope: FLORIPA, currency: "BRL", amount: 26_490 },
		]);
	});

	it("Example D: a BRL trip debt in ARS at each rate type", () => {
		const floripa = {
			lines: martinLines(),
			currency: "ARS",
			applyTo: [{ scope: FLORIPA }],
		};
		expect(
			allocatePayment({ ...floripa, amount: null, quotes: BLUE }).full,
		).toBe(11_178_800);
		expect(
			allocatePayment({ ...floripa, amount: null, quotes: OFFICIAL }).full,
		).toBe(10_807_500);
		// ARS 111,000 at Blue leaves BRL 2.91.
		const short = allocatePayment({
			...floripa,
			amount: 11_100_000,
			quotes: BLUE,
		});
		expect(short.remainder).toEqual([
			{ scope: FLORIPA, currency: "BRL", amount: 291 },
		]);
		// A typed ARS 112,000 at its own rate (271.52 per BRL) clears it.
		const custom = allocatePayment({
			...floripa,
			amount: 11_200_000,
			quotes: new Map([
				["BRL", quote("271.5151515151515151515151515", "custom")],
			]),
		});
		expect(cash(custom)).toEqual([[FLORIPA, "BRL", 41_250, 11_200_000]]);
	});

	it("Example E: everything with Valentina pays the net and offsets across currencies", () => {
		const lines = payerLines(
			ledgerLines(eventsFor(fixtureLedger().valentina, "me")),
			true,
		);
		const a = allocatePayment({
			lines,
			currency: "ARS",
			amount: null,
			quotes: BLUE,
		});
		expect(a.amount).toBe(2_568_800); // 128 x 271 - 9,000
		expect(a.everything).toBe(true);
		expect(cash(a)).toEqual([[FLORIPA, "BRL", 9_479, 2_568_800]]);
		expect(
			a.offsets.map((o) => [o.scope, o.currency, o.from, o.amount, o.value]),
		).toEqual([
			[null, "ARS", "payee", 900_000, 900_000],
			[FLORIPA, "BRL", "payer", 3_321, 900_000],
		]);
	});

	it("everything brings every scope to zero across several projects, cash exactly the net", () => {
		const lines = [
			{ scope: "a", currency: "USD", owed: 1000, oldest: "2026-10-01" },
			{ scope: "b", currency: "USD", owed: 4500, oldest: "2026-10-02" },
			{ scope: null, currency: "USD", owed: 500, oldest: "2026-10-03" },
			{ scope: "c", currency: "USD", owed: -1200, oldest: "2026-10-04" },
			{ scope: "d", currency: "USD", owed: -800, oldest: "2026-10-05" },
		];
		const a = allocatePayment({
			lines,
			currency: "USD",
			amount: null,
			quotes: new Map(),
		});
		expect(a.amount).toBe(4000);
		const left = new Map(lines.map((l) => [l.scope, l.owed]));
		for (const r of a.rows)
			left.set(r.scope, (left.get(r.scope) ?? 0) - r.amount);
		for (const o of a.offsets) {
			const sign = o.from === "payer" ? -1 : 1;
			left.set(o.scope, (left.get(o.scope) ?? 0) + sign * o.amount);
		}
		expect([...left.values()].every((v) => v === 0)).toBe(true);
	});

	it("an overpayment is reported and booked Outside projects only when allowed", () => {
		const lines = [
			{ scope: null, currency: "ARS", owed: 900_000, oldest: "2026-10-03" },
		];
		const refused = allocatePayment({
			lines,
			currency: "ARS",
			amount: 1_000_000,
			quotes: BLUE,
		});
		expect(refused.overpay).toBe(100_000);
		expect(refused.rows).toHaveLength(1);
		const allowed = allocatePayment({
			lines,
			currency: "ARS",
			amount: 1_000_000,
			quotes: BLUE,
			allowOverpay: true,
		});
		expect(cash(allowed)).toEqual([
			[null, "ARS", 900_000, 900_000],
			[null, "ARS", 100_000, 100_000],
		]);
		expect(allowed.rows[1]?.excess).toBe(true);
	});

	it("leaves a currency without a quote untouched and names it", () => {
		const a = allocatePayment({
			lines: martinLines(),
			currency: "ARS",
			amount: null,
			quotes: new Map(),
		});
		expect(a.unpriced).toEqual(["BRL"]);
		expect(a.rows.every((r) => r.currency === "ARS")).toBe(true);
	});

	it("never converts the wrong way when the payee owes more (everything pays nothing)", () => {
		const a = allocatePayment({
			lines: [
				{ scope: null, currency: "ARS", owed: 100_000, oldest: "2026-10-01" },
				{ scope: "x", currency: "ARS", owed: -500_000, oldest: "2026-10-02" },
			],
			currency: "ARS",
			amount: null,
			quotes: BLUE,
		});
		expect(a.full).toBe(0);
		expect(a.offsets).toEqual([]);
		expect(a.rows).toEqual([]);
	});

	it("dust is under ARS 1 for ARS only, else under one minor unit (§1.2 rule 5)", () => {
		expect(dustOf("ARS")).toBe(100);
		expect(dustOf("BRL")).toBe(1);
		expect(dustOf("JPY")).toBe(1);
		// Shown whole, but the whole-unit rule is ARS only.
		expect(dustOf("COP")).toBe(1);
		expect(dustOf("CLP")).toBe(1);
		const cop = allocatePayment({
			lines: [{ scope: null, currency: "COP", owed: 1_000_000, oldest: "2026-10-01" }],
			currency: "COP",
			amount: 1_000_050,
			quotes: new Map(),
		});
		expect(cop.overpay).toBe(50);
	});

	it("reports as overpay only what would be booked as excess", () => {
		// The payee owes more overall: the payment still only pays the payer's
		// own debt, and only what goes beyond it is excess.
		const lines = [
			{ scope: "trip", currency: "USD", owed: 5_000, oldest: "2026-10-01" },
			{ scope: "rent", currency: "USD", owed: -8_000, oldest: "2026-10-02" },
		];
		const within = allocatePayment({ lines, currency: "USD", amount: 2_000, quotes: new Map() });
		expect(within.overpay).toBe(0);
		expect(within.rows.map((r) => [r.scope, r.amount])).toEqual([["trip", 2_000]]);
		const beyond = allocatePayment({
			lines,
			currency: "USD",
			amount: 6_000,
			quotes: new Map(),
			allowOverpay: true,
		});
		expect(beyond.overpay).toBe(1_000);
		expect(beyond.rows.filter((r) => r.excess).map((r) => r.amount)).toEqual([1_000]);
	});

	it("rejects a fractional or negative amount", () => {
		expect(() =>
			allocatePayment({
				lines: [],
				currency: "ARS",
				amount: 1.5,
				quotes: BLUE,
			}),
		).toThrow(RangeError);
	});
});
