/**
 * The setup wizard's Flex proposal from the last 3 months, and the plan cost
 * the preview reads for it (what the wizard's Start gate stands on). USD book,
 * cents. Expected values by hand:
 *
 *   Dining spent 60.00 + 70.00 + 50.00 = 180.00 in the 3 months before this
 *   one (18,000 minor), and 999.00 this month. Spending proposes
 *   18,000 / 3 = 6,000 a month; this month's row is not history.
 *   A user with no past spending gets no proposal.
 *   Start with 1,000.00 (100,000): a Spending target of 6,000 costs 6,000 a
 *   month; Spending with no target costs 0, so nothing is planned.
 */
import { describe, expect, it } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { addRow, seedUser } from "./__tests__/pg-fixture";
import { setupPreset } from "./book.service";
import { setupEnvelopeBook } from "./setup.mutation";

const now = new Date();
const inMonth = (back: number) =>
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 10, 12));

type Spending = NonNullable<SetupInput["envelopes"][number]["target"]>;
const input = (target?: Spending): SetupInput => ({
	style: "FLEX",
	startingMoneyMinor: 100_000,
	groups: [{ key: "spending", name: "Spending", role: "SPENDING" }],
	envelopes: [
		{
			key: "spending",
			name: "Spending",
			groupKey: "spending",
			kind: "MONTHLY",
			isDefault: true,
			categoryIds: [],
			...(target ? { target } : {}),
		},
	],
});

const spendingTarget = async (userId: string) => {
	const preset = await userTransaction(adminDb, userId, (tx) =>
		setupPreset(tx, userId, "FLEX"),
	);
	return preset.envelopes.find((e) => e.key === "spending")?.target;
};

describe("setup wizard: Flex from history", () => {
	it("proposes the monthly average of the 3 months before this one", async () => {
		const s = await seedUser();
		for (const [back, amount] of [
			[1, 60],
			[2, 70],
			[3, 50],
		] as const)
			await addRow(
				s.user.id,
				{ amount, categoryId: s.dining },
				inMonth(back),
			);
		await addRow(s.user.id, { amount: 999, categoryId: s.dining }, inMonth(0));
		expect(await spendingTarget(s.user.id)).toEqual({
			kind: "MONTHLY",
			amountMinor: 6_000,
			mode: "REFILL",
			cadence: "MONTH",
		});
	});

	it("proposes nothing without history", async () => {
		const s = await seedUser();
		await addRow(s.user.id, { amount: 999, categoryId: s.dining }, inMonth(0));
		expect(await spendingTarget(s.user.id)).toBeNull();
	});

	it("the preview costs the typed Spending amount, and nothing without one", async () => {
		const s = await seedUser();
		const run = (target?: Spending) =>
			forUser(s.user.id).preview(setupEnvelopeBook, {
				...input(target),
				timeZone: "UTC",
			});
		const withAmount = await run({
			kind: "MONTHLY",
			amountMinor: 6_000,
			mode: "REFILL",
			cadence: "MONTH",
		});
		expect(withAmount.value.plan).toEqual({
			cost: { minor: 6_000, currency: "USD" },
			available: { minor: 100_000, currency: "USD" },
			short: { minor: 0, currency: "USD" },
		});
		const without = await run();
		expect(without.value.plan?.cost.minor).toBe(0);
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);
	});
});
