import { describe, expect, it } from "vitest";
import { movementEntries } from "./entries";
import { groupMovements, type MovementRow } from "./inputs-port";

const mv = (
	month: number,
	from: string | null,
	to: string | null,
	amount: string,
): MovementRow => ({ month, fromEnvelopeId: from, toEnvelopeId: to, amount });

describe("groupMovements", () => {
	it("sums per month, source and target, only after the checkpoint month", () => {
		const rows = [
			mv(202609, null, "a", "5000"),
			mv(202610, null, "a", "1000.10"),
			mv(202610, null, "a", "2000.20"),
			mv(202610, null, "a", "0.05"),
			mv(202610, "a", "b", "10"),
			mv(202611, null, "a", "1"),
		];
		const out = groupMovements(rows, 202609);
		const byKey = Object.fromEntries(
			out.map((g) => [
				`${g.month}:${g.fromEnvelopeId}:${g.toEnvelopeId}`,
				g.amount,
			]),
		);
		// 1000.10 + 2000.20 + 0.05 = 3000.35; the September row is behind the checkpoint.
		expect(byKey).toEqual({
			"202610:null:a": "3000.35",
			"202610:a:b": "10",
			"202611:null:a": "1",
		});
	});

	it("keeps the pool (null) and an envelope with the same id text apart", () => {
		const out = groupMovements(
			[mv(202610, null, "x", "1"), mv(202610, "null", "x", "2")],
			0,
		);
		expect(out).toHaveLength(2);
	});

	it("sums exactly past 20 significant digits", () => {
		const rows = Array.from({ length: 11 }, () =>
			mv(202610, null, "a", "99999999999.99999999"),
		);
		// 11 x (10^11 - 10^-8) = 1,099,999,999,999.99999989
		expect(groupMovements(rows, 0)[0]?.amount).toBe("1099999999999.99999989");
	});

	it("gives minor units in the book currency: KWD 3, ARS 2, JPY 0 decimals", () => {
		const rows = [
			mv(202610, null, "a", "1.234"),
			mv(202610, null, "a", "2.001"),
		];
		const sums = groupMovements(rows, 0); // 3.235
		expect(movementEntries(sums, "KWD")[0]?.minor).toBe(3235);
		// 3.235 x 100 = 323.5 -> half-even 324; JPY 3.235 -> 3
		expect(movementEntries(sums, "ARS")[0]?.minor).toBe(324);
		expect(movementEntries(sums, "JPY")[0]?.minor).toBe(3);
	});

	it("an empty set groups to nothing", () => {
		expect(groupMovements([], 0)).toEqual([]);
	});
});
