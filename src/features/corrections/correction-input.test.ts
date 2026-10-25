import { describe, expect, it } from "vitest";
import type { ExpenseDraft } from "../entry/expense/draft";
import { blankDraft } from "../entry/expense/use-expense-load";
import { correctionInput } from "./correction-input";

const you = { participantType: "user", participantId: "me" } as const;
const lucia = {
	participantType: "user",
	participantId: "lucia",
	name: "Lucía",
} as const;
const ID = "11111111-1111-4111-8111-111111111111";

const draft = (patch: Partial<ExpenseDraft>): ExpenseDraft => ({
	...blankDraft({ currency: "ARS", you }),
	categoryId: "cat1",
	others: [lucia],
	...patch,
});

const run = (d: ExpenseDraft) =>
	correctionInput(d, {
		id: ID,
		transactionId: "tx1",
		title: "Correction to Cena",
		you,
	});

describe("correctionInput", () => {
	it("sends an even split as the whole split now, with the contract's refs", () => {
		const out = run(draft({ minor: 5_200_000, amountText: "52,000" }));
		expect(out).toEqual({
			id: ID,
			transactionId: "tx1",
			description: "Correction to Cena",
			amount: "52000.00",
			paidBy: { type: "user", id: "me" },
			categoryId: "cat1",
			splitMode: "EQUAL",
			splitWith: [
				{ participant: { type: "user", id: "me" } },
				{ participant: { type: "user", id: "lucia" } },
			],
		});
	});

	it("writes exact rows as decimal strings, never an exponent", () => {
		const out = run(
			draft({
				minor: 1000,
				split: "custom",
				by: "amount",
				exact: { "user:me": 250, "user:lucia": 750 },
			}),
		);
		expect(out?.splitMode).toBe("EXACT");
		expect(out?.splitWith.map((r) => r.shareAmount)).toEqual(["2.50", "7.50"]);
	});

	it("passes percentages and share units through", () => {
		const pct = run(
			draft({
				minor: 1000,
				split: "custom",
				by: "pct",
				pct: { "user:me": 25, "user:lucia": 75 },
			}),
		);
		expect(pct?.splitWith.map((r) => r.sharePercentage)).toEqual([25, 75]);
		const units = run(
			draft({
				minor: 1000,
				split: "custom",
				by: "shares",
				shares: { "user:me": 1, "user:lucia": 3 },
			}),
		);
		expect(units?.splitWith.map((r) => r.shareUnits)).toEqual([1, 3]);
	});

	it("is null until there is an amount and a category", () => {
		expect(run(draft({ minor: null }))).toBeNull();
		expect(run(draft({ minor: 1000, categoryId: null }))).toBeNull();
	});
});
