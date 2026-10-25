/**
 * The setup preview's plan stop (envelope.setup): what the plan costs a month
 * against what the budget starts with. USD fixture book: Rent Set aside
 * 500.00 and Dining Refill 200.00, so the plan costs 70,000 minor units.
 * Expected values by hand:
 *
 *   Start with 1,000.00 (100,000): available 100,000, short 0.
 *   Start with 300.00 (30,000): available 30,000, short 70,000 - 30,000 = 40,000.
 *   Preview writes nothing (no book exists afterwards).
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { seedUser, setupInput } from "./__tests__/pg-fixture";
import { setupEnvelopeBook } from "./setup.mutation";

describe("envelope.setup preview: the plan against what you start with", () => {
	it("enough money: nothing is short", async () => {
		const s = await seedUser();
		const p = await forUser(s.user.id).preview(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 100_000,
			timeZone: "UTC",
		});
		expect(p.value.plan).toEqual({
			cost: { minor: 70_000, currency: "USD" },
			available: { minor: 100_000, currency: "USD" },
			short: { minor: 0, currency: "USD" },
		});
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);
	});

	it("not enough: short is the cost beyond what you have", async () => {
		const s = await seedUser();
		const p = await forUser(s.user.id).preview(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 30_000,
			timeZone: "UTC",
		});
		expect(p.value.plan).toEqual({
			cost: { minor: 70_000, currency: "USD" },
			available: { minor: 30_000, currency: "USD" },
			short: { minor: 40_000, currency: "USD" },
		});
	});
});
