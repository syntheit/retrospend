/**
 * The pure parts of envelope edits (budget stream 2B). Expected values by hand.
 *
 * settleDeltas: when a category link moves, the envelope that lost the
 * spending gains Left and the one that took it loses Left. Paying the gainers'
 * surplus to the losers puts every envelope's Left back where it was.
 *
 * mergeTargets: Dining Monthly Set aside 500.00 + Coffee Monthly Set aside
 * 300.00 (both in the book currency) is one 800 target; a EUR target next to
 * a book-currency one cannot be added without a rate, so it is dropped and
 * counted; a target on an envelope that had none is adopted whole.
 */
import { describe, expect, it } from "vitest";
import type { TargetSnapshot } from "~/lib/schemas/envelope-book";
import { mergeTargets, settleDeltas } from "./crud-math";

describe("settleDeltas", () => {
	it("pays the gainer's surplus to the loser", () => {
		expect(
			settleDeltas([
				{ id: "spending", delta: 3_000 },
				{ id: "coffee", delta: -3_000 },
			]),
		).toEqual([{ from: "spending", to: "coffee", minor: 3_000 }]);
	});

	it("splits one gainer across two losers, in id order", () => {
		// +5,000 gained; -2,000 and -3,000 lost.
		expect(
			settleDeltas([
				{ id: "z", delta: 5_000 },
				{ id: "b", delta: -3_000 },
				{ id: "a", delta: -2_000 },
			]),
		).toEqual([
			{ from: "z", to: "a", minor: 2_000 },
			{ from: "z", to: "b", minor: 3_000 },
		]);
	});

	it("writes nothing when every delta is 0", () => {
		expect(settleDeltas([{ id: "a", delta: 0 }])).toEqual([]);
	});

	it("refuses deltas that do not add up to 0", () => {
		expect(() => settleDeltas([{ id: "a", delta: 100 }])).toThrow();
	});
});

const monthly = (over: Partial<TargetSnapshot> = {}): TargetSnapshot => ({
	kind: "MONTHLY",
	targetAmount: "500.00",
	targetCurrency: null,
	targetMode: "SET_ASIDE",
	targetCadence: "MONTH",
	targetMonthlyAmount: null,
	targetDueDate: null,
	targetRepeat: null,
	targetTemplateId: null,
	targetLiabilityId: null,
	targetStartMonth: 202610,
	...over,
});
const none: TargetSnapshot = monthly({
	kind: "NONE",
	targetAmount: null,
	targetMode: "REFILL",
	targetStartMonth: null,
});

describe("mergeTargets", () => {
	it("adds two Monthly targets with the same mode, cadence and currency", () => {
		const r = mergeTargets(monthly(), [monthly({ targetAmount: "300.00" })]);
		expect(r.target.targetAmount).toBe("800");
		expect(r).toMatchObject({ summed: 1, dropped: 0 });
	});

	it("adds across several sources", () => {
		const r = mergeTargets(monthly(), [
			monthly({ targetAmount: "300.00" }),
			monthly({ targetAmount: "20.50" }),
		]);
		expect(r.target.targetAmount).toBe("820.5");
		expect(r.summed).toBe(2);
	});

	it("drops a foreign target next to a book-currency one", () => {
		const r = mergeTargets(monthly(), [
			monthly({ targetAmount: "100.00", targetCurrency: "EUR" }),
		]);
		expect(r.target).toEqual(monthly());
		expect(r).toMatchObject({ summed: 0, dropped: 1 });
	});

	it("drops a target of another mode or cadence", () => {
		const r = mergeTargets(monthly(), [
			monthly({ targetMode: "REFILL" }),
			monthly({ targetCadence: "WEEK" }),
		]);
		expect(r.target.targetAmount).toBe("500.00");
		expect(r.dropped).toBe(2);
	});

	it("adopts a source's target when the stayer has none", () => {
		const r = mergeTargets(none, [none, monthly({ targetAmount: "300.00" })]);
		expect(r.target).toEqual(monthly({ targetAmount: "300.00" }));
		expect(r).toMatchObject({ summed: 1, dropped: 0 });
	});

	it("ignores sources with no target", () => {
		const r = mergeTargets(monthly(), [none]);
		expect(r.target).toEqual(monthly());
		expect(r).toMatchObject({ summed: 0, dropped: 0 });
	});

	it("adopts into a Monthly envelope that has no amount yet", () => {
		const bare = monthly({ targetAmount: null });
		const r = mergeTargets(bare, [monthly({ targetAmount: "300.00" })]);
		expect(r.target.targetAmount).toBe("300.00");
	});

	it("does not turn a stayer into another kind, and Everything else stays Monthly", () => {
		const bill = monthly({
			kind: "BILL",
			targetDueDate: "2026-12-01",
			targetRepeat: "MONTHLY",
		});
		expect(mergeTargets(none, [bill], true).dropped).toBe(1);
		expect(mergeTargets(none, [bill], false).target).toEqual(bill);
		const bareMonthly = monthly({ targetAmount: null });
		expect(mergeTargets(bareMonthly, [bill]).dropped).toBe(1);
	});

	it("keeps a bill's own target and counts the source's as dropped", () => {
		const bill = monthly({
			kind: "BILL",
			targetDueDate: "2026-12-01",
			targetRepeat: "MONTHLY",
		});
		const r = mergeTargets(bill, [monthly()]);
		expect(r.target).toEqual(bill);
		expect(r.dropped).toBe(1);
	});
});
