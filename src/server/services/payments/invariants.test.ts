/**
 * MONEY-MOVES §3, I1 to I9, over the fixture ledger (Lucía, Martín, Paz,
 * Valentina, Florianópolis), each its own named test. Payments are recorded
 * through the production allocator, confirmation and counting rules.
 */
import { describe, expect, it } from "vitest";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
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

/** A handful of payments covering partial, converted, apply-to, everything and pending. */
function paymentsPlayed() {
	const people = fixtureLedger();
	recordPayment(people.martin, {
		payer: "me",
		recorder: "me",
		currency: "ARS",
		amount: 4_000_000,
	});
	recordPayment(people.martin, {
		payer: "me",
		recorder: "me",
		currency: "ARS",
		amount: 2_000_000,
		applyTo: [{ scope: FLORIPA }],
	});
	recordPayment(people.paz, {
		payer: "them",
		recorder: "me",
		currency: "USD",
		amount: 10_000,
		quotes: INTO_USD,
	});
	recordPayment(people.valentina, {
		payer: "me",
		recorder: "me",
		currency: "ARS",
		amount: null,
	});
	return people;
}

describe("money moves invariants", () => {
	it("I1 scopes add up: Σ over scopes of Balance(p, s, c) is Overall(p, c) for every person and currency", () => {
		for (const person of Object.values(paymentsPlayed())) {
			for (const viewer of ["me", "them"] as const) {
				const events = eventsFor(person, viewer);
				const direct = new Map<string, number>();
				for (const e of events)
					direct.set(e.currency, (direct.get(e.currency) ?? 0) + e.minor);
				for (const [c, v] of direct) if (v === 0) direct.delete(c);
				expect(overallByCurrency(ledgerLines(events))).toEqual(direct);
			}
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

	it("I9 project group balances: Σ over members of Paid − Share − Received + Sent is zero after a multi-scope payment", () => {
		const martin = fixtureLedger().martin;
		const a = allocatePayment({
			lines: payerLines(linesOf(martin), true),
			currency: "ARS",
			amount: 16_598_800,
			quotes: BLUE,
		});
		const floripa = a.rows.filter((r) => r.scope === FLORIPA);
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
			floripa.map((r) => ({
				fromParticipantType: "user",
				fromParticipantId: "sofia",
				toParticipantType: "user",
				toParticipantId: "martin",
				amount: r.amount / 100,
				currency: r.currency,
			})),
		);
		for (const breakdown of Object.values(plan.byCurrency)) {
			const total = breakdown.balances.reduce(
				(t, b) => t + Math.round(b.netBalance * 100),
				0,
			);
			expect(total).toBe(0);
		}
	});
});
