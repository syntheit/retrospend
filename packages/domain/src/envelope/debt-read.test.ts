/**
 * The payoff projection over a hand-made source: total debt in the book
 * currency at the book's rate type, the saved plan or the slider's override,
 * and a debt with no rate left out and listed, never valued at 1. ARS book,
 * UTC, blue 1,500 and EUR with no rate at all, the clock 2026-11-14T15:00Z.
 */
import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import { type DebtSource, type LiabilityRow, payoffFrom } from "./debt-read";

const NOW = new Date("2026-11-14T15:00:00Z");

const visa: LiabilityRow = {
	id: "visa",
	currency: "USD",
	balance: dec("1000"),
	interestRate: null,
	minimumPayment: null,
	dueDate: null,
};

function source(liabilities: LiabilityRow[]): DebtSource {
	return {
		book: async () => ({
			currency: "ARS",
			timeZone: "UTC",
			periods: [{ fromMonth: 202611, startDay: 1, rateType: "blue" }],
		}),
		savedPlan: async () => ({
			strategy: "AVALANCHE",
			extraMonthly: { minor: 0, currency: "ARS" },
			customOrder: [],
			envelopeId: null,
		}),
		liabilities: async () => liabilities,
		rateRows: async () => [
			{ currency: "ARS", type: "blue", rate: "1500", date: "2026-10-01" },
		],
	};
}

describe("payoffFrom", () => {
	it("totals the debt in the book currency at the book's rate type", async () => {
		const p = await payoffFrom(source([visa]), {}, NOW);
		// USD 1,000 x 1,500 = ARS 1,500,000.00 = 150,000,000 minor.
		expect(p.totalDebt).toEqual({ minor: 150_000_000, currency: "ARS" });
		expect(p.debts.map((d) => d.balance)).toEqual([
			{ minor: 100_000, currency: "USD" },
		]);
		expect(p.incomplete).toBe(false);
		expect(p.missingRates).toEqual([]);
	});

	it("is zero with no debt", async () => {
		const p = await payoffFrom(source([]), {}, NOW);
		expect(p.totalDebt).toEqual({ minor: 0, currency: "ARS" });
		expect(p.debts).toEqual([]);
	});

	it("leaves out a debt with no rate and says so", async () => {
		const eur: LiabilityRow = { ...visa, id: "eur", currency: "EUR" };
		const p = await payoffFrom(source([visa, eur]), {}, NOW);
		expect(p.totalDebt).toEqual({ minor: 150_000_000, currency: "ARS" });
		expect(p.missingRates).toEqual([
			{ assetAccountId: "eur", currency: "EUR" },
		]);
		expect(p.incomplete).toBe(true);
	});

	it("takes the slider's overrides over the saved plan", async () => {
		const p = await payoffFrom(
			source([visa]),
			{ strategy: "SNOWBALL", extraMonthlyMinor: 5_000_000 },
			NOW,
		);
		expect(p.plan.strategy).toBe("SNOWBALL");
		expect(p.plan.extraMonthly).toEqual({ minor: 5_000_000, currency: "ARS" });
		expect(p.plan.customOrder).toEqual([]);
	});
});
