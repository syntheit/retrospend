// The port's rows plug straight into the domain device loaders.
import {
	spentInputsFromRows,
	spentMinorByCurrency,
} from "@retrospend/domain/spent";
import { describe, expect, it } from "vitest";
import { fixtureRow } from "./fixtures";
import { MemoryStore, type Reader } from "./index";

const MARCH = {
	start: new Date("2026-03-01T00:00:00Z"),
	end: new Date("2026-03-31T23:59:59Z"),
};

/** Home currency ARS, blue 1,500, March. */
const seed = () =>
	new MemoryStore({
		rows: {
			settings: [
				{ ...fixtureRow("settings", "user"), hiddenProjectIds: ["hidden"] },
			],
			expenses: [
				{
					...fixtureRow("expenses", "e1"),
					amount: "30000.50",
					amountInUSD: "20.0003",
				},
				{ ...fixtureRow("expenses", "e2"), amount: "15000", amountInUSD: "10" },
				{
					...fixtureRow("expenses", "refund"),
					amount: "7500",
					amountInUSD: "5",
					direction: "IN",
					inType: "REFUND",
				},
				{
					...fixtureRow("expenses", "excluded"),
					amount: "500",
					excludeFromAnalytics: true,
				},
				{
					...fixtureRow("expenses", "february"),
					amount: "700",
					date: new Date("2026-02-28T12:00:00Z"),
				},
			],
			shares: [
				{
					...fixtureRow("shares", "s1"),
					shareAmount: "75000",
					exchangeRate: "1500",
				},
				{
					...fixtureRow("shares", "s2"),
					shareAmount: "99999",
					projectId: "hidden",
				},
			],
		},
	});

const spentMinor = (rows: Reader) =>
	spentMinorByCurrency(
		spentInputsFromRows({
			expenses: rows.list("expenses"),
			shares: rows.list("shares"),
			hiddenProjectIds: rows.get("settings", "user")?.hiddenProjectIds ?? [],
			range: MARCH,
		}),
	);

describe("store rows feed spentInputsFromRows", () => {
	// 30,000.50 + 15,000 - 7,500 refunded + 75,000 share = ARS 112,500.50.
	// Left out: the excluded row, the February row, the share in a hidden project.
	it("reads the figure from a snapshot", () => {
		expect(spentMinor(seed().snapshot())).toEqual([
			{ minor: 11_250_050, currency: "ARS" },
		]);
	});

	it("a preview reads its own write, and rolling back restores the figure", async () => {
		const store = seed();
		const tx = await store.begin();
		tx.put("expenses", {
			...fixtureRow("expenses", "preview"),
			amount: "1000",
		});
		// + ARS 1,000.00
		expect(spentMinor(tx)).toEqual([{ minor: 11_350_050, currency: "ARS" }]);
		expect(spentMinor(store)).toEqual([{ minor: 11_250_050, currency: "ARS" }]);
		tx.rollback();
		expect(spentMinor(store)).toEqual([{ minor: 11_250_050, currency: "ARS" }]);
	});
});
