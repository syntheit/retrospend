import { describe, expect, it } from "vitest";
import type { PairEvent } from "../payments/ledger";
import { settledAsOf } from "./locks";

const share = (
	date: string,
	minor: number,
	scope: string | null = null,
): PairEvent => ({
	date,
	scope,
	currency: "ARS",
	minor,
	kind: "share",
});
const payment = (
	date: string,
	minor: number,
	extra: Partial<PairEvent> = {},
): PairEvent => ({
	date,
	scope: null,
	currency: "ARS",
	minor,
	kind: "payment",
	...extra,
});

describe("settledAsOf", () => {
	it("15,000 owed and 15,000 paid is settled", () => {
		expect(
			settledAsOf(
				[share("2026-10-01", 1_500_000), payment("2026-10-05", -1_500_000)],
				null,
				"2026-10-05",
			),
		).toBe(true);
	});

	it("a part payment is not", () => {
		expect(
			settledAsOf(
				[share("2026-10-01", 1_500_000), payment("2026-10-05", -400_000)],
				null,
				"2026-10-05",
			),
		).toBe(false);
	});

	it("a payment the other side has not confirmed settles nothing", () => {
		expect(
			settledAsOf(
				[
					share("2026-10-01", 1_500_000),
					payment("2026-10-05", -1_500_000, { pending: true }),
				],
				null,
				"2026-10-05",
			),
		).toBe(false);
	});

	it("reads the balance as of the payment's day: a later share does not undo it", () => {
		expect(
			settledAsOf(
				[
					share("2026-10-01", 1_500_000),
					payment("2026-10-05", -1_500_000),
					share("2026-10-20", 100_000),
				],
				null,
				"2026-10-05",
			),
		).toBe(true);
	});

	it("looks at one scope at a time", () => {
		const events = [
			share("2026-10-01", 1_500_000),
			share("2026-10-02", 700_000, "trip"),
			payment("2026-10-05", -1_500_000),
		];
		expect(settledAsOf(events, null, "2026-10-05")).toBe(true);
		expect(settledAsOf(events, "trip", "2026-10-05")).toBe(false);
	});

	it("a balance in another currency still counts", () => {
		expect(
			settledAsOf(
				[
					share("2026-10-01", 1_500_000),
					payment("2026-10-05", -1_500_000),
					{ ...share("2026-10-02", 5_000), currency: "USD" },
				],
				null,
				"2026-10-05",
			),
		).toBe(false);
	});
});
