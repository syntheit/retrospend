import { movedParts } from "./changeParts";
import type { NetWorth } from "./source";

const zero = { minor: 0, currency: "ARS" };

function change(parts: Partial<Record<string, number>>) {
	const all = Object.fromEntries(
		[
			"income",
			"spending",
			"exchange",
			"notLogged",
			"revaluation",
			"opened",
			"closed",
		].map((key) => [key, { minor: parts[key] ?? 0, currency: "ARS" }]),
	);
	return { days: 30, total: zero, parts: all } as unknown as NonNullable<
		NetWorth["change"]
	>;
}

describe("why net worth moved", () => {
	it("lists only the parts that moved, in the web's order", () => {
		expect(
			movedParts(change({ revaluation: -500, income: 10_000, closed: 1 })),
		).toEqual(["income", "revaluation", "closed"]);
	});

	it("lists nothing when nothing moved", () => {
		expect(movedParts(change({}))).toEqual([]);
	});
});
