import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBalance } from "./balance";
import type { ParticipantRef } from "./types";

const alice: ParticipantRef = {
	participantType: "user",
	participantId: "alice-id",
};
const bob: ParticipantRef = {
	participantType: "user",
	participantId: "bob-id",
};

function createMockDb(
	splits: {
		payer: ParticipantRef;
		participant: ParticipantRef;
		shareAmount: number;
		currency: string;
	}[],
	settlements: {
		from: ParticipantRef;
		to: ParticipantRef;
		amount: number;
		currency: string;
	}[],
) {
	return {
		splitParticipant: {
			findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
				const w = where as {
					participantType: string;
					participantId: string;
					transaction: { paidByType: string; paidById: string };
				};
				return splits
					.filter(
						(s) =>
							s.participant.participantType === w.participantType &&
							s.participant.participantId === w.participantId &&
							s.payer.participantType === w.transaction.paidByType &&
							s.payer.participantId === w.transaction.paidById,
					)
					.map((s) => ({
						shareAmount: s.shareAmount,
						transaction: { currency: s.currency },
					}));
			}),
		},
		settlement: {
			findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
				const w = where as {
					fromParticipantType: string;
					fromParticipantId: string;
					toParticipantType: string;
					toParticipantId: string;
					status: { in: string[] };
				};
				return settlements
					.filter(
						(s) =>
							s.from.participantType === w.fromParticipantType &&
							s.from.participantId === w.fromParticipantId &&
							s.to.participantType === w.toParticipantType &&
							s.to.participantId === w.toParticipantId &&
							Array.isArray(w.status?.in) &&
							w.status.in.includes("FINALIZED"),
					)
					.map((s) => ({
						amount: s.amount,
						currency: s.currency,
					}));
			}),
		},
	};
}

describe("computeBalance", () => {
	it("returns empty when no transactions between them", async () => {
		const db = createMockDb([], []);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({});
	});

	it("returns positive when B owes A (A paid, B is participant)", async () => {
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: bob,
					shareAmount: 25,
					currency: "USD",
				},
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: 25 });
	});

	it("returns negative when A owes B (B paid, A is participant)", async () => {
		const db = createMockDb(
			[
				{
					payer: bob,
					participant: alice,
					shareAmount: 30,
					currency: "USD",
				},
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: -30 });
	});

	it("handles bidirectional debts that partially cancel", async () => {
		const db = createMockDb(
			[
				// Alice paid $50, Bob's share is $25
				{
					payer: alice,
					participant: bob,
					shareAmount: 25,
					currency: "USD",
				},
				// Bob paid $30, Alice's share is $15
				{
					payer: bob,
					participant: alice,
					shareAmount: 15,
					currency: "USD",
				},
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		// Bob owes Alice 25, Alice owes Bob 15 -> net: Bob owes Alice 10
		expect(result.byCurrency).toEqual({ USD: 10 });
	});

	it("settlements reduce the balance", async () => {
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: bob,
					shareAmount: 50,
					currency: "USD",
				},
			],
			[
				// Bob settles $20 to Alice
				{ from: bob, to: alice, amount: 20, currency: "USD" },
			],
		);
		const result = await computeBalance(db as never, alice, bob);
		// Bob owed 50, paid 20 -> 30 remaining
		expect(result.byCurrency).toEqual({ USD: 30 });
	});

	it("handles partial settlements", async () => {
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: bob,
					shareAmount: 100,
					currency: "USD",
				},
			],
			[
				{ from: bob, to: alice, amount: 30, currency: "USD" },
				{ from: bob, to: alice, amount: 25, currency: "USD" },
			],
		);
		const result = await computeBalance(db as never, alice, bob);
		// 100 - 30 - 25 = 45
		expect(result.byCurrency).toEqual({ USD: 45 });
	});

	it("returns empty when balance is exactly zero after full settlement", async () => {
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: bob,
					shareAmount: 50,
					currency: "USD",
				},
			],
			[{ from: bob, to: alice, amount: 50, currency: "USD" }],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({});
	});

	it("handles multiple currencies independently", async () => {
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: bob,
					shareAmount: 25,
					currency: "USD",
				},
				{
					payer: alice,
					participant: bob,
					shareAmount: 5000,
					currency: "ARS",
				},
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: 25, ARS: 5000 });
	});

	it("returns empty for same participant", async () => {
		const db = createMockDb([], []);
		const result = await computeBalance(db as never, alice, alice);
		expect(result.byCurrency).toEqual({});
	});

	it("settlements from A to B increase what B owes A", async () => {
		// Edge case: Alice sends money to Bob (maybe by mistake or advance)
		// This increases Bob's debt to Alice
		const db = createMockDb(
			[],
			[{ from: alice, to: bob, amount: 20, currency: "USD" }],
		);
		const result = await computeBalance(db as never, alice, bob);
		// A paid B 20 -> B owes A 20 more
		expect(result.byCurrency).toEqual({ USD: 20 });
	});

	it("handles shadow profile participants", async () => {
		const shadow: ParticipantRef = {
			participantType: "shadow",
			participantId: "shadow-marcus",
		};
		const db = createMockDb(
			[
				{
					payer: alice,
					participant: shadow,
					shareAmount: 40,
					currency: "USD",
				},
			],
			[],
		);
		const result = await computeBalance(db as never, alice, shadow);
		expect(result.byCurrency).toEqual({ USD: 40 });
	});

	// ── spec scenarios ────────────────────────────────────────────────────────

	it("spec: Alice pays $100 split equally with Bob → Bob owes Alice $50", async () => {
		// 2-person equal split: each person's shareAmount is $50.
		// computeBalance(alice, bob) sees bob's share in an alice-paid transaction.
		const db = createMockDb(
			[{ payer: alice, participant: bob, shareAmount: 50, currency: "USD" }],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: 50 });
	});

	it("spec: Alice pays $100 split 3 ways: pairwise balances are $33.33 each", async () => {
		// 3-way equal split: $33.34 to payer (alice), $33.33 to each of bob and carol.
		// computeBalance(alice, bob) only sees bob's share ($33.33) in alice-paid txn.
		// computeBalance(alice, carol) only sees carol's share ($33.33) in alice-paid txn.
		const carol: ParticipantRef = {
			participantType: "user",
			participantId: "carol-id",
		};

		const dbBob = createMockDb(
			[{ payer: alice, participant: bob, shareAmount: 33.33, currency: "USD" }],
			[],
		);
		const dbCarol = createMockDb(
			[
				{
					payer: alice,
					participant: carol,
					shareAmount: 33.33,
					currency: "USD",
				},
			],
			[],
		);

		const resultBob = await computeBalance(dbBob as never, alice, bob);
		const resultCarol = await computeBalance(dbCarol as never, alice, carol);

		expect(resultBob.byCurrency).toEqual({ USD: 33.33 });
		expect(resultCarol.byCurrency).toEqual({ USD: 33.33 });
	});

	it("spec: Alice pays $100 for Bob, Bob pays $60 for Alice → Bob owes net $20", async () => {
		// Alice paid $100, split equally: alice $50, bob $50 → bob owes alice $50
		// Bob paid $60, split equally: alice $30, bob $30 → alice owes bob $30
		// Net: bob owes alice $50 - $30 = $20
		const db = createMockDb(
			[
				{ payer: alice, participant: bob, shareAmount: 50, currency: "USD" },
				{ payer: bob, participant: alice, shareAmount: 30, currency: "USD" },
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: 20 });
	});

	it("over-settlement: Bob settles $60 when he only owes $50 → Alice owes Bob $10", async () => {
		// Bob's shareAmount: $50. Bob settles $60. Balance = 50 - 60 = -10.
		// Negative means alice owes bob (balance flips direction).
		const db = createMockDb(
			[{ payer: alice, participant: bob, shareAmount: 50, currency: "USD" }],
			[{ from: bob, to: alice, amount: 60, currency: "USD" }],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({ USD: -10 });
	});

	it("optimistic settlements: both FINALIZED and PROPOSED statuses are queried", async () => {
		// Settlements are optimistic — PROPOSED settlements count toward balance
		// immediately. The query must include both FINALIZED and PROPOSED.
		const db = createMockDb(
			[{ payer: alice, participant: bob, shareAmount: 50, currency: "USD" }],
			[],
		);

		await computeBalance(db as never, alice, bob);

		// Both settlement queries (B→A and A→B) must filter to FINALIZED + PROPOSED
		const calls = (db.settlement.findMany as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(calls).toHaveLength(2);
		for (const [callArgs] of calls) {
			const status = (callArgs as { where: { status: { in: string[] } } }).where
				.status;
			expect(status).toEqual({ in: ["FINALIZED", "PROPOSED"] });
		}
	});

	it("locked (settled) transactions are still included in balance computation", async () => {
		// isLocked is a UI/edit guard, not a financial exclusion. Locked transactions
		// are immutable but continue to count toward balances.
		// The computeBalance query does NOT filter by isLocked: all rows are included.
		// This test confirms locked transactions affect the balance exactly like any other.
		const db = createMockDb(
			[
				// Simulate a "locked" transaction: the balance function doesn't know or care
				{ payer: alice, participant: bob, shareAmount: 75, currency: "USD" },
			],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		// Locked transaction still contributes to bob's debt
		expect(result.byCurrency).toEqual({ USD: 75 });
	});

	it("deleted transaction is excluded: after hard-delete the record is gone from the DB", async () => {
		// SharedTransactions are hard-deleted (not soft-deleted). Once deleted,
		// no splitParticipant row exists for that transaction, so computeBalance
		// naturally excludes it. The mock below simulates a world where the deleted
		// transaction's rows simply don't exist in the query results.
		const db = createMockDb(
			// No splits: the transaction was deleted, leaving no rows
			[],
			[],
		);
		const result = await computeBalance(db as never, alice, bob);
		expect(result.byCurrency).toEqual({});
	});

	it("multiple currencies: two separate balances, NOT netted across currencies", async () => {
		// USD and ARS are tracked independently. A $100 USD debt and a 5000 ARS debt
		// remain separate entries and must not be cross-currency netted.
		const db = createMockDb(
			[
				{ payer: alice, participant: bob, shareAmount: 100, currency: "USD" },
				{ payer: alice, participant: bob, shareAmount: 5000, currency: "ARS" },
			],
			[
				// Settling USD has no effect on ARS balance
				{ from: bob, to: alice, amount: 100, currency: "USD" },
			],
		);
		const result = await computeBalance(db as never, alice, bob);
		// USD: 100 - 100 = 0 (settled, removed)
		// ARS: 5000 still outstanding
		expect(result.byCurrency).toEqual({ ARS: 5000 });
		expect(result.byCurrency.USD).toBeUndefined();
	});
});
