import { describe, expect, it } from "vitest";
import {
	computeSettlementPlan,
	type SettlementForPlan,
	type TxForSettlement,
} from "./group-settlement";

// ── helpers ───────────────────────────────────────────────────────────────────

function userRef(id: string) {
	return { participantType: "user" as const, participantId: id };
}

function tx(
	payer: string,
	amount: number,
	currency: string,
	shares: { id: string; amount: number }[],
): TxForSettlement {
	return {
		currency,
		amount,
		paidByType: "user",
		paidById: payer,
		splitParticipants: shares.map((s) => ({
			participantType: "user",
			participantId: s.id,
			shareAmount: s.amount,
		})),
	};
}

function settlement(
	from: string,
	to: string,
	amount: number,
	currency: string,
): SettlementForPlan {
	return {
		fromParticipantType: "user",
		fromParticipantId: from,
		toParticipantType: "user",
		toParticipantId: to,
		amount,
		currency,
	};
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("computeSettlementPlan", () => {
	it("returns empty plan when there are no transactions", () => {
		const result = computeSettlementPlan([], []);
		expect(result.byCurrency).toEqual({});
		expect(result.participantCount).toBe(0);
	});

	it("single creditor / single debtor: one payment", () => {
		// Alice pays $100 split equally with Bob
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		const { plan, balances } = result.byCurrency.USD!;

		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			from: userRef("bob"),
			to: userRef("alice"),
			amount: 50,
			currency: "USD",
		});

		const alice = balances.find(
			(b) => b.participant.participantId === "alice",
		)!;
		const bob = balances.find((b) => b.participant.participantId === "bob")!;
		expect(alice.totalPaid).toBe(100);
		expect(alice.fairShare).toBe(50);
		expect(alice.netBalance).toBe(50);
		expect(bob.totalPaid).toBe(0);
		expect(bob.fairShare).toBe(50);
		expect(bob.netBalance).toBe(-50);
	});

	it("3 participants: greedy produces correct plan", () => {
		// Alice pays $60 for all three equally ($20 each)
		// Bob pays $30 for Bob and Carol ($15 each)
		// Net: Alice +40, Bob -5, Carol -35
		const txns = [
			tx("alice", 60, "USD", [
				{ id: "alice", amount: 20 },
				{ id: "bob", amount: 20 },
				{ id: "carol", amount: 20 },
			]),
			tx("bob", 30, "USD", [
				{ id: "bob", amount: 15 },
				{ id: "carol", amount: 15 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		const { plan } = result.byCurrency.USD!;

		// Greedy: Carol(-35) → Alice(+40): $35. Then Bob(-5) → Alice(+5): $5.
		expect(plan).toHaveLength(2);
		expect(plan[0]).toMatchObject({
			from: userRef("carol"),
			to: userRef("alice"),
			amount: 35,
		});
		expect(plan[1]).toMatchObject({
			from: userRef("bob"),
			to: userRef("alice"),
			amount: 5,
		});
	});

	it("all balances zero: empty plan", () => {
		// Alice and Bob each pay for themselves only
		const txns = [
			tx("alice", 50, "USD", [{ id: "alice", amount: 50 }]),
			tx("bob", 50, "USD", [{ id: "bob", amount: 50 }]),
		];
		const result = computeSettlementPlan(txns, []);
		expect(result.byCurrency.USD!.plan).toHaveLength(0);
	});

	it("single creditor, multiple debtors", () => {
		// Alice pays $90 split three ways ($30 each)
		const txns = [
			tx("alice", 90, "USD", [
				{ id: "alice", amount: 30 },
				{ id: "bob", amount: 30 },
				{ id: "carol", amount: 30 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		const { plan } = result.byCurrency.USD!;

		expect(plan).toHaveLength(2);
		const payments = plan.map((p) => ({
			from: p.from.participantId,
			amount: p.amount,
		}));
		expect(payments).toContainEqual({ from: "bob", amount: 30 });
		expect(payments).toContainEqual({ from: "carol", amount: 30 });
		for (const p of plan) {
			expect(p.to.participantId).toBe("alice");
		}
	});

	it("participant who paid and owes but nets to zero: not in plan", () => {
		// Alice pays $50 for Alice($25) and Bob($25)
		// Bob pays $50 for Alice($25) and Bob($25)
		// Both net to zero
		const txns = [
			tx("alice", 50, "USD", [
				{ id: "alice", amount: 25 },
				{ id: "bob", amount: 25 },
			]),
			tx("bob", 50, "USD", [
				{ id: "alice", amount: 25 },
				{ id: "bob", amount: 25 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		expect(result.byCurrency.USD!.plan).toHaveLength(0);
	});

	it("solo project / single participant: empty plan", () => {
		// Alice pays $100 and is the only participant
		const txns = [tx("alice", 100, "USD", [{ id: "alice", amount: 100 }])];
		const result = computeSettlementPlan(txns, []);
		expect(result.byCurrency.USD!.plan).toHaveLength(0);
	});

	it("rounding: $100 / 3: balances sum to ~zero, plan is valid", () => {
		// $100 split among 3: payer gets extra cent ($33.34), others get $33.33
		// This simulates the extra-cent-to-payer rule from the split engine
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 33.34 },
				{ id: "bob", amount: 33.33 },
				{ id: "carol", amount: 33.33 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		const { plan, balances } = result.byCurrency.USD!;

		// Balances should sum to ~zero
		const balanceSum = balances.reduce((sum, b) => sum + b.netBalance, 0);
		expect(Math.abs(balanceSum)).toBeLessThan(0.01);

		// Plan should have 2 payments (bob and carol pay alice)
		expect(plan).toHaveLength(2);
		for (const p of plan) {
			expect(p.to.participantId).toBe("alice");
			expect(p.amount).toBeCloseTo(33.33, 1);
		}
	});

	it("multiple currencies: separate plans, no cross-currency conversion", () => {
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
			tx("alice", 5000, "ARS", [
				{ id: "alice", amount: 2500 },
				{ id: "bob", amount: 2500 },
			]),
		];
		const result = computeSettlementPlan(txns, []);

		expect(Object.keys(result.byCurrency)).toHaveLength(2);

		const usdPlan = result.byCurrency.USD!.plan;
		expect(usdPlan).toHaveLength(1);
		expect(usdPlan[0]).toMatchObject({ amount: 50, currency: "USD" });

		const arsPlan = result.byCurrency.ARS!.plan;
		expect(arsPlan).toHaveLength(1);
		expect(arsPlan[0]).toMatchObject({ amount: 2500, currency: "ARS" });
	});

	it("confirmed settlements partially offset balances", () => {
		// Alice paid $100, Bob owes $50. Bob already settled $20.
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
		];
		const settlements = [settlement("bob", "alice", 20, "USD")];
		const result = computeSettlementPlan(txns, settlements);
		const { plan } = result.byCurrency.USD!;

		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			from: userRef("bob"),
			to: userRef("alice"),
			amount: 30,
		});
	});

	it("confirmed settlements that fully zero out a debt: participant absent from plan", () => {
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
		];
		const settlements = [settlement("bob", "alice", 50, "USD")];
		const result = computeSettlementPlan(txns, settlements);
		expect(result.byCurrency.USD!.plan).toHaveLength(0);
	});

	it("rounding across 5 transactions: 3-way equal $100 splits: balances sum to ~zero, plan is valid", () => {
		// Each of 5 transactions splits $100 among 3 people.
		// The extra cent (due to $100/3 not being exact) goes to whoever paid that tx.
		// After 5 txns (3 paid by alice, 1 by bob, 1 by carol), the plan should still
		// produce whole-cent payments with balances summing to ~0.
		const txns = [
			// Alice pays tx1: alice $33.34, bob $33.33, carol $33.33
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 33.34 },
				{ id: "bob", amount: 33.33 },
				{ id: "carol", amount: 33.33 },
			]),
			// Bob pays tx2: alice $33.33, bob $33.34, carol $33.33
			tx("bob", 100, "USD", [
				{ id: "alice", amount: 33.33 },
				{ id: "bob", amount: 33.34 },
				{ id: "carol", amount: 33.33 },
			]),
			// Carol pays tx3: alice $33.33, bob $33.33, carol $33.34
			tx("carol", 100, "USD", [
				{ id: "alice", amount: 33.33 },
				{ id: "bob", amount: 33.33 },
				{ id: "carol", amount: 33.34 },
			]),
			// Alice pays tx4
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 33.34 },
				{ id: "bob", amount: 33.33 },
				{ id: "carol", amount: 33.33 },
			]),
			// Alice pays tx5
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 33.34 },
				{ id: "bob", amount: 33.33 },
				{ id: "carol", amount: 33.33 },
			]),
		];

		const result = computeSettlementPlan(txns, []);
		const { plan, balances } = result.byCurrency.USD!;

		// Balances must sum to ~zero (floating point accumulation should not exceed $0.01)
		const balanceSum = balances.reduce((sum, b) => sum + b.netBalance, 0);
		expect(Math.abs(balanceSum)).toBeLessThan(0.01);

		// Plan must have exactly 2 payments (bob→alice, carol→alice)
		expect(plan).toHaveLength(2);
		for (const p of plan) {
			expect(p.to.participantId).toBe("alice");
			expect(["bob", "carol"]).toContain(p.from.participantId);
			// Each payment must be a positive whole-cent amount
			expect(p.amount).toBeGreaterThan(0);
			expect(Math.round(p.amount * 100)).toBe(p.amount * 100);
		}
	});

	it("over-settled participant: settlement exceeds debt, balance flips", () => {
		// Alice paid $100 split equally. Bob owes alice $50.
		// Bob then over-settled with $60 (confirmed). Bob is now a net creditor (+$10).
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
		];
		const settlements = [settlement("bob", "alice", 60, "USD")];

		const result = computeSettlementPlan(txns, settlements);
		const { plan, balances } = result.byCurrency.USD!;

		const alice = balances.find(
			(b) => b.participant.participantId === "alice",
		)!;
		const bob = balances.find((b) => b.participant.participantId === "bob")!;

		// alice: paid 100, share 50, received 60 → net = 100-50-60 = -10 (debtor now)
		expect(alice.netBalance).toBeCloseTo(-10, 5);
		// bob: paid 0, share 50, paid out 60 → net = 0-50+60 = +10 (creditor now)
		expect(bob.netBalance).toBeCloseTo(10, 5);

		// Plan: alice pays bob $10 (direction reversed from original debt)
		expect(plan).toHaveLength(1);
		expect(plan[0]).toMatchObject({
			from: userRef("alice"),
			to: userRef("bob"),
			amount: 10,
		});
	});

	it("participantCount counts unique participants across all currencies", () => {
		const txns = [
			tx("alice", 100, "USD", [
				{ id: "alice", amount: 50 },
				{ id: "bob", amount: 50 },
			]),
			tx("carol", 5000, "ARS", [
				{ id: "carol", amount: 2500 },
				{ id: "dave", amount: 2500 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		// alice, bob, carol, dave = 4 unique participants
		expect(result.participantCount).toBe(4);
	});

	it("4-person group: greedy minimizes payment count", () => {
		// Alice: +30, Bob: +20, Carol: -25, Dave: -25
		const txns = [
			tx("alice", 75, "USD", [
				{ id: "alice", amount: 45 }, // alice: paid 75, share 45, net +30
				{ id: "carol", amount: 15 },
				{ id: "dave", amount: 15 },
			]),
			tx("bob", 70, "USD", [
				{ id: "bob", amount: 50 }, // bob: paid 70, share 50, net +20
				{ id: "carol", amount: 10 },
				{ id: "dave", amount: 10 },
			]),
		];
		const result = computeSettlementPlan(txns, []);
		const { plan, balances } = result.byCurrency.USD!;

		// Verify balances
		const alice = balances.find(
			(b) => b.participant.participantId === "alice",
		)!;
		const bob = balances.find((b) => b.participant.participantId === "bob")!;
		const carol = balances.find(
			(b) => b.participant.participantId === "carol",
		)!;
		const dave = balances.find((b) => b.participant.participantId === "dave")!;

		expect(alice.netBalance).toBe(30);
		expect(bob.netBalance).toBe(20);
		expect(carol.netBalance).toBe(-25);
		expect(dave.netBalance).toBe(-25);

		// Plan should have at most 3 payments for 4 people (n-1 is upper bound)
		expect(plan.length).toBeLessThanOrEqual(3);

		// All payments go to creditors
		for (const p of plan) {
			expect(["alice", "bob"]).toContain(p.to.participantId);
			expect(["carol", "dave"]).toContain(p.from.participantId);
		}

		// Each creditor should receive exactly their positive net balance;
		// each debtor should pay exactly their absolute net balance.
		const received: Record<string, number> = {};
		const paid: Record<string, number> = {};
		for (const p of plan) {
			paid[p.from.participantId] = (paid[p.from.participantId] ?? 0) + p.amount;
			received[p.to.participantId] =
				(received[p.to.participantId] ?? 0) + p.amount;
		}
		expect(Math.round((received.alice ?? 0) * 100)).toBe(3000);
		expect(Math.round((received.bob ?? 0) * 100)).toBe(2000);
		expect(Math.round((paid.carol ?? 0) * 100)).toBe(2500);
		expect(Math.round((paid.dave ?? 0) * 100)).toBe(2500);
	});
});
