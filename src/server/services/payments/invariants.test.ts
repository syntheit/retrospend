/**
 * MONEY-MOVES §3, I1 to I9, over the fixture ledger (Lucía, Martín, Paz,
 * Valentina, Florianópolis), each its own named test. Payments are recorded
 * through the production allocator, confirmation and counting rules.
 */
import { vi, describe, expect, it } from "vitest";

// The in-memory database has no lock query (see ~/test/locks-stub).
vi.mock("~/server/services/corrections/locks", () => import("~/test/locks-stub"));
import { computeBalance } from "~/server/services/shared-expenses/balance";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
import { createStatefulDb } from "~/server/services/shared-expenses/test-utils";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { allocatePayment } from "./allocate";
import { findClaimMatch } from "./claim-match";
import {
	ledgerLines,
	overallByCurrency,
	payerLines,
	settledSince,
} from "./ledger";
import { netInHome, owedTotals } from "./owed";
import {
	type RecordPaymentInput,
	recordPayment as recordMutation,
} from "./record.mutation";
import {
	BLUE,
	confirmPayment,
	DEPTO,
	eventsFor,
	type FixturePerson,
	FLORIPA,
	fixtureLedger,
	INTO_USD,
	recordPayment,
	rowsOf,
	TODAY,
	type Who,
} from "./test-fixtures";

const linesOf = (p: FixturePerson, viewer: Who = "me") =>
	ledgerLines(eventsFor(p, viewer));

/** Balance per "scope|currency" from `viewer`'s side, zeros included as absent. */
function balanceMap(p: FixturePerson, viewer: Who = "me") {
	return new Map(
		linesOf(p, viewer).map((l) => [
			`${l.scope ?? ""}|${l.currency}`,
			l.balance,
		]),
	);
}

/** An expense on the in-memory DB: `payer` paid `amount`, all of it owed by `debtor`. */
function seedInMemory(
	db: ReturnType<typeof createStatefulDb>,
	payer: ParticipantRef,
	debtor: ParticipantRef,
	amount: number,
	currency: string,
	projectId: string | null,
	date: string,
) {
	const id = `tx-${db._stores.transactions.size + 1}`;
	db._stores.transactions.set(id, {
		id,
		description: "Fixture",
		amount,
		currency,
		date: new Date(date),
		paidByType: payer.participantType,
		paidById: payer.participantId,
		createdByType: payer.participantType,
		createdById: payer.participantId,
		splitMode: "EXACT",
		projectId,
		billingPeriodId: null,
		isLocked: false,
		notes: null,
		receiptUrl: null,
		categoryId: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	for (const [ref, share] of [
		[debtor, amount],
		[payer, 0],
	] as const) {
		const spId = `sp-${db._stores.splits.size + 1}`;
		db._stores.splits.set(spId, {
			id: spId,
			transactionId: id,
			participantType: ref.participantType,
			participantId: ref.participantId,
			shareAmount: share,
			sharePercentage: null,
			shareUnits: null,
			verificationStatus: "ACCEPTED",
			verifiedAt: new Date(),
			rejectionReason: null,
			hasUnseenChanges: false,
		});
	}
}

describe("money moves invariants", () => {
	it("I1 scopes add up: Σ over scopes of Balance(p, s, c) is Overall(p, c), through the real balance queries", async () => {
		// Martín's fixture ledger on the in-memory DB, then payments through
		// payment.record: partial, Apply to Florianópolis, and one received.
		const db = createStatefulDb();
		const sofia = { participantType: "user" as const, participantId: "sofia" };
		const martin = {
			participantType: "user" as const,
			participantId: "martin",
		};
		for (const r of fixtureLedger().martin.records) {
			if (r.kind !== "share") continue;
			const [payer, debtor] = r.minor > 0 ? [sofia, martin] : [martin, sofia];
			seedInMemory(
				db,
				payer,
				debtor,
				Math.abs(r.minor) / 100,
				r.currency,
				r.scope,
				r.date,
			);
		}
		const pay = (input: Partial<RecordPaymentInput>) =>
			recordMutation.run(
				db as never,
				{
					person: martin,
					direction: "outgoing",
					currency: "ARS",
					amount: "40000",
					...input,
				},
				{ userId: "sofia" },
			);
		await pay({});
		await pay({ amount: "20000", applyTo: [{ scope: FLORIPA }] });
		await pay({
			direction: "incoming",
			amount: "5000",
			applyTo: [{ scope: DEPTO }],
			allowOverpay: true,
		});

		for (const [me, them] of [
			[sofia, martin],
			[martin, sofia],
		] as const) {
			const overall = await computeBalance(db as never, me, them);
			const sums: Record<string, number> = {};
			for (const projectScope of [null, DEPTO, FLORIPA]) {
				const scoped = await computeBalance(db as never, me, them, {
					projectScope,
				});
				for (const [c, v] of Object.entries(scoped.byCurrency)) {
					sums[c] = (sums[c] ?? 0) + Math.round(v * 100);
				}
			}
			const expected = Object.fromEntries(
				Object.entries(overall.byCurrency).map(([c, v]) => [
					c,
					Math.round(v * 100),
				]),
			);
			expect(
				Object.fromEntries(Object.entries(sums).filter(([, v]) => v !== 0)),
			).toEqual(expected);
			expect(Object.keys(expected).length).toBeGreaterThan(0);
		}
	});

	it("I2 rows add up: cash rows sum to the payment exactly and offsets net to zero in value", () => {
		const people = fixtureLedger();
		const cases = [
			recordPayment(people.martin, {
				payer: "me",
				recorder: "me",
				currency: "ARS",
				amount: 16_598_800,
			}),
			recordPayment(people.paz, {
				payer: "them",
				recorder: "me",
				currency: "USD",
				amount: 12_345,
				quotes: INTO_USD,
			}),
			recordPayment(people.valentina, {
				payer: "me",
				recorder: "me",
				currency: "ARS",
				amount: null,
			}),
			recordPayment(people.lucia, {
				payer: "them",
				recorder: "me",
				currency: "ARS",
				amount: 1_234_567,
			}),
		];
		for (const a of cases) {
			expect(a.rows.reduce((t, r) => t + r.paid, 0)).toBe(a.amount);
			const payer = a.offsets
				.filter((o) => o.from === "payer")
				.reduce((t, o) => t + o.value, 0);
			const payee = a.offsets
				.filter((o) => o.from === "payee")
				.reduce((t, o) => t + o.value, 0);
			expect(payer).toBe(payee);
		}
	});

	it("I3 no side effects: zero scopes stay zero, no scope changes sign, unnamed currencies do not move", () => {
		const people = fixtureLedger();
		const runs: Array<[FixturePerson, Parameters<typeof recordPayment>[1]]> = [
			[
				people.martin,
				{ payer: "me", recorder: "me", currency: "ARS", amount: 4_000_000 },
			],
			[
				people.martin,
				{
					payer: "me",
					recorder: "me",
					currency: "ARS",
					amount: 3_000_000,
					applyTo: [{ scope: FLORIPA }],
				},
			],
			[
				people.lucia,
				{ payer: "them", recorder: "me", currency: "ARS", amount: 20_000_000 },
			],
			[
				people.paz,
				{
					payer: "them",
					recorder: "me",
					currency: "USD",
					amount: 5_000,
					quotes: INTO_USD,
				},
			],
			// More than everything, not confirmed: records nothing.
			[
				people.paz,
				{ payer: "them", recorder: "me", currency: "ARS", amount: 99_000_000 },
			],
		];
		for (const [person, args] of runs) {
			const before = balanceMap(person);
			const allocation = recordPayment(person, args);
			const after = balanceMap(person);
			const named = new Set(
				allocation.rows.map((r) => `${r.scope ?? ""}|${r.currency}`),
			);
			for (const key of new Set([...before.keys(), ...after.keys()])) {
				const b = before.get(key) ?? 0;
				const a = after.get(key) ?? 0;
				if (b === 0) expect(a).toBe(0);
				if (a !== 0) expect(Math.sign(a)).toBe(Math.sign(b));
				if (!named.has(key)) expect(a).toBe(b);
			}
		}
	});

	it("I4 one payment, one record: every row of a multi-scope payment carries the same payment", () => {
		const martin = fixtureLedger().martin;
		recordPayment(
			martin,
			{ payer: "me", recorder: "me", currency: "ARS", amount: 16_598_800 },
			"pm-everything",
		);
		const rows = rowsOf(martin, "pm-everything");
		expect(rows.map((r) => r.scope)).toEqual([null, DEPTO, FLORIPA]);
		expect(
			new Set(
				martin.records.filter((r) => r.kind === "row").map((r) => r.paymentId),
			).size,
		).toBe(2);
	});

	it("I5 recorder now, other side at confirm: payer counts their pending payment, receiver does not, then both agree", () => {
		const martin = fixtureLedger().martin;
		recordPayment(
			martin,
			{ payer: "me", recorder: "me", currency: "ARS", amount: 16_598_800 },
			"pm-a",
		);
		expect(overallByCurrency(linesOf(martin, "me"))).toEqual(new Map());
		expect(overallByCurrency(linesOf(martin, "them"))).toEqual(
			new Map([
				["ARS", 5_420_000],
				["BRL", 41_250],
			]),
		);
		confirmPayment(martin, "pm-a");
		const mine = balanceMap(martin, "me");
		const theirs = balanceMap(martin, "them");
		for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
			expect(mine.get(key) ?? 0).toBe(-(theirs.get(key) ?? 0));
		}
		// Lucía's own claim counts for her, not for Sofía.
		const lucia = fixtureLedger().lucia;
		const sofia = overallByCurrency(linesOf(lucia, "me")).get("ARS");
		const hers = overallByCurrency(linesOf(lucia, "them")).get("ARS");
		expect(sofia).toBe(16_850_000);
		expect(hers).toBe(-14_850_000);
	});

	it("I6 a match moves the balance once: Same payment confirms Lucía's claim, a different payment does not", () => {
		const lucia = fixtureLedger().lucia;
		const claims = rowsOf(lucia, "pm-lucia-claim").map((r) => ({
			paymentId: r.paymentId,
			amount: r.amount,
			currency: r.currency,
			paidOn: r.date,
			paymentMethod: "Cash",
		}));
		const match = findClaimMatch(
			claims,
			{ amount: 2_000_000, currency: "ARS", paidOn: TODAY },
			() => null,
		);
		expect(match?.claim.paymentId).toBe("pm-lucia-claim");
		expect(match?.sameAmount).toBe(true);

		const before = overallByCurrency(linesOf(lucia)).get("ARS")!;
		confirmPayment(lucia, "pm-lucia-claim");
		expect(overallByCurrency(linesOf(lucia)).get("ARS")).toBe(
			before - 2_000_000,
		);
		expect(
			new Set(
				lucia.records.filter((r) => r.kind === "row").map((r) => r.paymentId),
			).size,
		).toBe(2);

		const other = fixtureLedger().lucia;
		recordPayment(other, {
			payer: "them",
			recorder: "me",
			currency: "ARS",
			amount: 2_000_000,
		});
		expect(overallByCurrency(linesOf(other)).get("ARS")).toBe(
			before - 2_000_000,
		);
		expect(rowsOf(other, "pm-lucia-claim")[0]?.status).toBe("PROPOSED");
	});

	it("I7 settled since is the date of the payment that zeroed every balance, and only while zero", () => {
		const martin = fixtureLedger().martin;
		const open = settledSince(eventsFor(martin, "me"));
		expect(open.overall).toBeNull();
		// Depto Palermo was at zero from Oct 16 until the water heater on Oct 20.
		expect(open.byScope.get(DEPTO)).toBeNull();

		recordPayment(
			martin,
			{
				payer: "me",
				recorder: "me",
				currency: "ARS",
				amount: 16_598_800,
				paidOn: "2026-10-21",
			},
			"pm-all",
		);
		const paid = settledSince(eventsFor(martin, "me"));
		expect(paid.overall).toBe("2026-10-21");
		expect(paid.pending).toBe(true);
		expect(paid.byScope.get(DEPTO)).toBe("2026-10-21");

		confirmPayment(martin, "pm-all");
		expect(settledSince(eventsFor(martin, "them"))).toMatchObject({
			overall: "2026-10-21",
			pending: false,
		});
		expect(settledSince([]).nothingShared).toBe(true);
	});

	it("I8 owed is one number: Owed to you and You owe are sums of per-person nets at the reference rate, never netted", () => {
		const people = fixtureLedger();
		const nets = Object.values(people).map(
			(p) => netInHome(overallByCurrency(linesOf(p)), "ARS", BLUE)!,
		);
		// Martín −165,987.50; Lucía 334,460.40; Paz 191,787.50; Valentina −25,688.
		expect(nets).toEqual([-16_598_750, 33_446_040, 19_178_750, -2_568_800]);
		expect(owedTotals(nets)).toEqual({
			owedToYou: 52_624_790,
			youOwe: 19_167_550,
		});
		expect(netInHome(new Map([["EUR", 100]]), "ARS", BLUE)).toBeNull();
	});

	it("I9 project group balances: Paid − Share − Received + Sent per member, after a payment, add up to zero", () => {
		// Florianópolis, BRL: Martín paid 900 for three (300 each), Sofía paid
		// 375 for herself and Martín (187.50 each). Sofía owes Martín 112.50 and
		// pays it all; Paz owes Martín 300 and has not paid.
		const a = allocatePayment({
			lines: [
				{ scope: FLORIPA, currency: "BRL", owed: 11_250, oldest: "2026-10-09" },
			],
			currency: "BRL",
			amount: null,
			quotes: new Map(),
		});
		expect(a.rows.map((r) => r.amount)).toEqual([11_250]);
		const me = { participantType: "user" as const, participantId: "sofia" };
		const him = { participantType: "user" as const, participantId: "martin" };
		const paz = { participantType: "shadow" as const, participantId: "paz" };
		const plan = computeSettlementPlan(
			[
				{
					paidByType: "user",
					paidById: "martin",
					amount: 900,
					currency: "BRL",
					splitParticipants: [
						{ ...me, shareAmount: 300 },
						{ ...him, shareAmount: 300 },
						{ ...paz, shareAmount: 300 },
					],
				},
				{
					paidByType: "user",
					paidById: "sofia",
					amount: 375,
					currency: "BRL",
					splitParticipants: [
						{ ...him, shareAmount: 187.5 },
						{ ...me, shareAmount: 187.5 },
					],
				},
			],
			a.rows.map((r) => ({
				fromParticipantType: "user",
				fromParticipantId: "sofia",
				toParticipantType: "user",
				toParticipantId: "martin",
				amount: r.amount / 100,
				currency: r.currency,
			})),
		);
		const balances = Object.fromEntries(
			(plan.byCurrency.BRL?.balances ?? []).map((b) => [
				b.participant.participantId,
				b.netBalance,
			]),
		);
		// Martín 900 − 487.50 − 112.50 received; Sofía 375 − 487.50 + 112.50 sent; Paz −300.
		expect(balances).toEqual({ martin: 300, sofia: 0, paz: -300 });
		expect(Object.values(balances).reduce((t, v) => t + v, 0)).toBe(0);
		// The plan only asks Paz to pay: Sofía is settled in the group.
		expect(plan.byCurrency.BRL?.plan).toEqual([
			{ from: paz, to: him, amount: 300, currency: "BRL" },
		]);
	});
});
