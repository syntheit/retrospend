import { describe, expect, it } from "vitest";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
import { type SummaryLedger, summarizeLedger } from "./summary";

const A = { participantType: "user" as const, participantId: "a" };
const B = { participantType: "user" as const, participantId: "b" };
const C = { participantType: "user" as const, participantId: "c" };
const S = { participantType: "shadow" as const, participantId: "s" };
type Ref = typeof A | typeof S;

const tx = (
	currency: string,
	amount: string,
	payer: Ref,
	shares: Array<[Ref, string]>,
) => ({
	currency,
	amount,
	paidByType: payer.participantType,
	paidById: payer.participantId,
	splitParticipants: shares.map(([r, share]) => ({ ...r, shareAmount: share })),
});

const pay = (from: Ref, to: Ref, amount: string, currency: string) => ({
	fromParticipantType: from.participantType,
	fromParticipantId: from.participantId,
	toParticipantType: to.participantType,
	toParticipantId: to.participantId,
	amount,
	currency,
});

/** The trip from __tests__/trip-fixture.ts. */
const trip: SummaryLedger = {
	transactions: [
		tx("BRL", "300", A, [
			[A, "100"],
			[B, "100"],
			[C, "100"],
		]),
		tx("BRL", "90", B, [
			[A, "30"],
			[B, "30"],
			[S, "30"],
		]),
		tx("USD", "50", C, [
			[A, "20"],
			[C, "30"],
		]),
		tx("BRL", "60", A, [
			[A, "30"],
			[B, "30"],
		]),
	],
	settlements: [pay(B, A, "40", "BRL")],
};

const lineOf = (
	n: ReturnType<typeof summarizeLedger>,
	key: string,
	cur: string,
) =>
	n.members.find((m) => m.key === key)?.lines.find((l) => l.currency === cur);

describe("summarizeLedger", () => {
	const n = summarizeLedger(trip, [A, B, C, S]);

	it("adds each currency's expenses into the group total", () => {
		// BRL 300 + 90 + 60 = 450; USD 50. Never one cross-currency number.
		expect(n.total).toEqual([
			{ minor: 45000, currency: "BRL" },
			{ minor: 5000, currency: "USD" },
		]);
	});

	it("gives Paid, Share, Received, Sent and Balance per member and currency", () => {
		// Ana BRL: paid 300 + 60, share 100 + 30 + 30, received Ben's 40:
		// 360 - 160 - 40 + 0 = 160.
		expect(lineOf(n, "user:a", "BRL")).toEqual({
			currency: "BRL",
			paid: 36000,
			share: 16000,
			received: 4000,
			sent: 0,
			balance: 16000,
		});
		// Ben BRL: 90 - 160 - 0 + 40 = -30.
		expect(lineOf(n, "user:b", "BRL")).toEqual({
			currency: "BRL",
			paid: 9000,
			share: 16000,
			received: 0,
			sent: 4000,
			balance: -3000,
		});
		expect(lineOf(n, "user:c", "BRL")?.balance).toBe(-10000);
		expect(lineOf(n, "shadow:s", "BRL")?.balance).toBe(-3000);
		// USD: Ana's share 20 against nothing paid; Cam paid 50, share 30.
		expect(lineOf(n, "user:a", "USD")?.balance).toBe(-2000);
		expect(lineOf(n, "user:c", "USD")?.balance).toBe(2000);
		expect(lineOf(n, "user:b", "USD")).toBeUndefined();
	});

	it("I9: balances add up to zero in every currency", () => {
		expect(n.imbalance).toEqual([]);
		for (const cur of ["BRL", "USD"]) {
			const sum = n.members
				.flatMap((m) => m.lines)
				.filter((l) => l.currency === cur)
				.reduce((t, l) => t + l.balance, 0);
			expect(sum).toBe(0);
		}
	});

	it("settles each currency with the fewest transfers, ties in ledger order", () => {
		// Ana is owed 160; Cam owes 100, then Ben and Sam 30 each: Ben paid an
		// expense, so the plan meets him before Sam.
		expect(
			n.transfers.map((t) => [
				t.from.participantId,
				t.to.participantId,
				t.amount,
			]),
		).toEqual([
			["c", "a", { minor: 10000, currency: "BRL" }],
			["b", "a", { minor: 3000, currency: "BRL" }],
			["s", "a", { minor: 3000, currency: "BRL" }],
			["a", "c", { minor: 2000, currency: "USD" }],
		]);
	});

	it("lists equal debts in the same order as the settlement plan", () => {
		const plan = computeSettlementPlan(
			trip.transactions.map((t) => ({
				...t,
				splitParticipants: [...t.splitParticipants],
			})),
			[...trip.settlements],
		);
		const fromPlan = Object.values(plan.byCurrency).flatMap((c) =>
			c.plan.map((p) => [
				p.from.participantId,
				p.to.participantId,
				p.amount * 100,
			]),
		);
		expect(
			n.transfers.map((t) => [
				t.from.participantId,
				t.to.participantId,
				t.amount.minor,
			]),
		).toEqual(fromPlan);
	});

	it("lists members first, idle ones too, then anyone else on the ledger", () => {
		const idle = { participantType: "guest" as const, participantId: "g" };
		const m = summarizeLedger(trip, [B, idle, A]);
		expect(m.members.map((x) => x.key)).toEqual([
			"user:b",
			"guest:g",
			"user:a",
			"shadow:s",
			"user:c",
		]);
		expect(m.members[1]?.lines).toEqual([]);
	});

	it("counts a payment in a currency with no expenses", () => {
		// Ben paid Ana USD 10 in a BRL-only project: Ana owes it back.
		const m = summarizeLedger({
			transactions: [
				tx("BRL", "10", A, [
					[A, "5"],
					[B, "5"],
				]),
			],
			settlements: [pay(B, A, "10", "USD")],
		});
		expect(lineOf(m, "user:a", "USD")).toMatchObject({
			received: 1000,
			balance: -1000,
		});
		expect(m.transfers.at(-1)).toEqual({
			from: A,
			to: B,
			amount: { minor: 1000, currency: "USD" },
		});
	});

	it("reports shares that do not add up instead of hiding them", () => {
		// 100.00 paid, shares 33.33 x 3 = 99.99: the group is one cent short.
		const m = summarizeLedger({
			transactions: [
				tx("BRL", "100", A, [
					[A, "33.33"],
					[B, "33.33"],
					[C, "33.33"],
				]),
			],
			settlements: [],
		});
		expect(m.imbalance).toEqual([{ minor: 1, currency: "BRL" }]);
	});

	it("uses each currency's minor unit and rounds half to even", () => {
		const m = summarizeLedger({
			transactions: [
				tx("JPY", "1000", A, [
					[A, "334"],
					[B, "333"],
					[C, "333"],
				]),
				tx("USD", "0.25", A, [
					[A, "0.125"],
					[B, "0.125"],
				]),
			],
			settlements: [],
		});
		expect(m.total).toEqual([
			{ minor: 1000, currency: "JPY" },
			{ minor: 25, currency: "USD" },
		]);
		// 0.125 USD = 12.5 cents, half-even: 12.
		expect(lineOf(m, "user:b", "USD")?.share).toBe(12);
		expect(m.imbalance).toEqual([{ minor: 1, currency: "USD" }]);
	});

	it("is empty for a project with nothing in it", () => {
		expect(summarizeLedger({ transactions: [], settlements: [] }, [A])).toEqual(
			{
				total: [],
				members: [{ ref: A, key: "user:a", lines: [] }],
				transfers: [],
				imbalance: [],
			},
		);
	});
});
