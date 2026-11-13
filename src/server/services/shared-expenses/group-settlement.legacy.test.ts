/**
 * The settlement plan on legacy rows stored at 8 decimals (a share of
 * 12.73333333), money-decimal PR 6a. The plan, the summary and the settle
 * check read one posting (ledger-posting.ts): every row rounds once, half to
 * even, so the nets sum to zero and match the Summary tab.
 */
import { currencyDecimals } from "@retrospend/domain/money";
import { Dec } from "@retrospend/domain/precise-decimal";
import { describe, expect, it } from "vitest";
import { summarizeLedger } from "~/server/services/project/summary";
import {
	computePaymentOnlyOutstanding,
	computePeriodOutstanding,
	computeSettlementPlan,
	isFullySettled,
	type SettlementForPlan,
	type TxForSettlement,
} from "./group-settlement";
import { refKey } from "./ledger-posting";

const user = (id: string) => ({
	participantType: "user" as const,
	participantId: id,
});

const expense = (
	payer: string,
	amount: string,
	currency: string,
	shares: Array<[string, string]>,
): TxForSettlement => ({
	currency,
	amount,
	paidByType: "user",
	paidById: payer,
	splitParticipants: shares.map(([id, shareAmount]) => ({
		...user(id),
		shareAmount,
	})),
});

const payment = (
	from: string,
	to: string,
	amount: string,
	currency: string,
): SettlementForPlan => ({
	fromParticipantType: "user",
	fromParticipantId: from,
	toParticipantType: "user",
	toParticipantId: to,
	amount,
	currency,
});

describe("USD 38.20 in three shares of 12.73333333", () => {
	// Ana paid 38.20 = 3820 cents. Each share rounds to 1273, 3819 together,
	// so the 1 cent no share covers is Ana's own: her share is 1273 + 1 = 1274.
	// Ana: 3820 - 1274 = 2546. Bob: -1273. Cam: -1273. They sum to zero.
	const shares: Array<[string, string]> = [
		["ana", "12.73333333"],
		["bob", "12.73333333"],
		["cam", "12.73333333"],
	];

	it("nets 2546, -1273, -1273 and the plan pays 12.73 twice", () => {
		const usd = computeSettlementPlan(
			[expense("ana", "38.20", "USD", shares)],
			[],
		).byCurrency.USD;
		expect(usd?.balances.map((b) => b.netBalance)).toEqual([
			25.46, -12.73, -12.73,
		]);
		expect(usd?.plan.map((p) => [p.from.participantId, p.amount])).toEqual([
			["bob", 12.73],
			["cam", 12.73],
		]);
	});

	// Bob and Cam each pay the 12.73 the People page shows: Ana received
	// 2546, so her net is 3820 - 1274 - 2546 = 0, and Bob's is -1273 + 1273 = 0.
	// The result does not depend on the order of the shares or the payments.
	it.each([
		["shares ana, bob, cam; payments bob, cam", shares, ["bob", "cam"]],
		[
			"shares cam, bob, ana; payments cam, bob",
			[...shares].reverse(),
			["cam", "bob"],
		],
	] as const)("is settled at zero, %s", (_name, order, payers) => {
		const txs = [expense("ana", "38.20", "USD", [...order])];
		const paid = payers.map((p) => payment(p, "ana", "12.73", "USD"));
		const usd = computeSettlementPlan(txs, paid).byCurrency.USD;
		expect(usd?.balances.map((b) => b.netBalance)).toEqual(order.map(() => 0));
		expect(usd?.plan).toEqual([]);
		expect(computePeriodOutstanding(txs, paid)).toEqual([]);
	});

	it("is still open after only one of them pays", () => {
		const txs = [expense("ana", "38.20", "USD", shares)];
		const open = computePeriodOutstanding(txs, [
			payment("bob", "ana", "12.73", "USD"),
		]);
		// Ana is owed 25.46 - 12.73 = 12.73 and Cam owes 12.73.
		expect(open.map((o) => [o.participant.participantId, o.amount])).toEqual([
			["ana", 12.73],
			["cam", -12.73],
		]);
	});
});

describe("rounding each share past the amount falls on the payer", () => {
	// USD 10.03 in two shares of 5.015: each rounds to 5.02 (501.5 is a tie,
	// 502 is even), 10.04 of 10.03. The exact shares equal the amount, so the
	// payer absorbs the extra cent, as People has it (Bob owes Ana 5.02).
	const both: Array<[string, string]> = [
		["ana", "5.015"],
		["bob", "5.015"],
	];

	it("Ana +5.02, Bob -5.02, and Bob pays Ana 5.02", () => {
		// Ana: paid 1003, share 502 - 1 = 501, net 502. Bob: -502.
		const txs = [expense("ana", "10.03", "USD", both)];
		const usd = computeSettlementPlan(txs, []).byCurrency.USD;
		expect(usd?.balances.map((b) => b.netBalance)).toEqual([5.02, -5.02]);
		expect(
			usd?.plan.map((p) => [
				p.from.participantId,
				p.to.participantId,
				p.amount,
			]),
		).toEqual([["bob", "ana", 5.02]]);
		const summary = summarizeLedger({ transactions: txs, settlements: [] });
		expect(summary.members.map((m) => m.lines[0]?.balance)).toEqual([
			502, -502,
		]);
		expect(summary.imbalance).toEqual([]);
	});

	it("is settled at zero once Bob pays 5.02, and the period lists nobody", () => {
		const txs = [expense("ana", "10.03", "USD", both)];
		const paid = [payment("bob", "ana", "5.02", "USD")];
		const usd = computeSettlementPlan(txs, paid).byCurrency.USD;
		expect(usd?.balances.map((b) => b.netBalance)).toEqual([0, 0]);
		expect(usd?.plan).toEqual([]);
		expect(computePeriodOutstanding(txs, paid)).toEqual([]);
	});

	it("a payer who is not in the split: Ana +10.04, Bob -5.02, Cam -5.02", () => {
		// Ana paid 1003 for Bob and Cam at 502 each (1004). Her own share is
		// -1, so her net is 1003 + 1 = 1004, which is what Bob and Cam owe her.
		const txs = [
			expense("ana", "10.03", "USD", [
				["bob", "5.015"],
				["cam", "5.015"],
			]),
		];
		const usd = computeSettlementPlan(txs, []).byCurrency.USD;
		expect(usd?.balances.map((b) => b.netBalance)).toEqual([
			10.04, -5.02, -5.02,
		]);
		expect(usd?.balances[0]?.fairShare).toBe(-0.01);
		expect(usd?.plan.map((p) => [p.from.participantId, p.amount])).toEqual([
			["bob", 5.02],
			["cam", 5.02],
		]);
		expect(
			summarizeLedger({ transactions: txs, settlements: [] }).members.map(
				(m) => m.lines[0]?.balance,
			),
		).toEqual([1004, -502, -502]);
	});

	it("shares that exceed the amount exactly stay an imbalance", () => {
		// 5 + 6 of 10: Ana +5, Bob -6, the cent-less -1 is the data fault.
		const txs = [
			expense("ana", "10.00", "USD", [
				["ana", "5"],
				["bob", "6"],
			]),
		];
		const summary = summarizeLedger({ transactions: txs, settlements: [] });
		expect(summary.imbalance).toEqual([{ minor: -100, currency: "USD" }]);
		expect(
			computeSettlementPlan(txs, []).byCurrency.USD?.balances.map(
				(b) => b.netBalance,
			),
		).toEqual([5, -6]);
	});
});

describe("every payment counts, in the currency it was made in", () => {
	// A USD-only project; Cam paid Dan EUR 10 with no EUR expense anywhere.
	const txs = [
		expense("ana", "30.00", "USD", [
			["ana", "10"],
			["cam", "10"],
			["dan", "10"],
		]),
	];
	const eur = [payment("cam", "dan", "10", "EUR")];

	it("lists a EUR plan where Dan pays Cam 10, and the project is not settled", () => {
		// Cam sent 1000: +1000. Dan received 1000: -1000.
		const result = computeSettlementPlan(txs, eur);
		expect(
			result.byCurrency.EUR?.plan.map((p) => [
				p.from.participantId,
				p.to.participantId,
				p.amount,
			]),
		).toEqual([["dan", "cam", 10]]);
		expect(isFullySettled(result)).toBe(false);
		expect(Object.keys(result.byCurrency).sort()).toEqual(["EUR", "USD"]);
		expect(result.participantCount).toBe(3);
	});

	it("names those balances as outstanding for any period", () => {
		expect(
			computePaymentOnlyOutstanding(txs, eur).map((o) => [
				o.participant.participantId,
				o.currency,
				o.amount,
			]),
		).toEqual([
			["cam", "EUR", 10],
			["dan", "EUR", -10],
		]);
		expect(computePaymentOnlyOutstanding(txs, [])).toEqual([]);
	});
});

// A small seeded generator (mulberry32), so the rows below are the same on
// every run.
function seeded(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("the plan and the summary are one figure on random legacy rows", () => {
	const people = ["ana", "bob", "cam", "dan"];

	interface Ledger {
		transactions: TxForSettlement[];
		settlements: SettlementForPlan[];
	}

	function randomLedger(next: () => number): Ledger {
		const pick = <T>(list: readonly T[]): T =>
			list[Math.floor(next() * list.length)] as T;
		const transactions: TxForSettlement[] = [];
		for (let i = 0; i < 1 + Math.floor(next() * 6); i++) {
			const currency = pick(["USD", "ARS", "JPY"]);
			const places = currencyDecimals(currency);
			const amount = new Dec(1 + Math.floor(next() * 500000))
				.div(new Dec(10).pow(places))
				.toFixed(places);
			const members = people.filter(() => next() < 0.75);
			if (members.length === 0) members.push("ana");
			// Equal shares cut at 8 decimals, the way a legacy row was stored.
			const share = new Dec(amount)
				.div(members.length)
				.toDecimalPlaces(8, Dec.ROUND_DOWN)
				.toFixed(8);
			transactions.push(
				expense(
					pick(members),
					amount,
					currency,
					members.map((m) => [m, share] as [string, string]),
				),
			);
		}
		const settlements: SettlementForPlan[] = [];
		for (const tx of transactions) {
			if (next() < 0.5 || tx.splitParticipants.length < 2) continue;
			const from = pick(tx.splitParticipants).participantId;
			if (from === tx.paidById) continue;
			const places = currencyDecimals(tx.currency);
			settlements.push(
				payment(
					from,
					tx.paidById,
					new Dec(1 + Math.floor(next() * 2000))
						.div(new Dec(10).pow(places))
						.toFixed(places),
					tx.currency,
				),
			);
		}
		// Payments between any two people, in any currency, whether or not an
		// expense was ever made in it.
		for (let i = 0; i < Math.floor(next() * 3); i++) {
			const from = pick(people);
			const to = pick(people.filter((p) => p !== from));
			const currency = pick(["USD", "ARS", "JPY", "EUR", "BRL"]);
			const places = currencyDecimals(currency);
			settlements.push(
				payment(
					from,
					to,
					new Dec(1 + Math.floor(next() * 2000))
						.div(new Dec(10).pow(places))
						.toFixed(places),
					currency,
				),
			);
		}
		return { transactions, settlements };
	}

	it("gives every person the summary's balance and the summary's transfers, and sums to its imbalance", () => {
		const next = seeded(20261113);
		for (let n = 0; n < 200; n++) {
			const ledger = randomLedger(next);
			const summary = summarizeLedger(ledger);
			const plan = computeSettlementPlan(
				ledger.transactions,
				ledger.settlements,
			);
			expect(
				Object.keys(plan.byCurrency).sort(),
				`currencies in ledger ${n}`,
			).toEqual(
				[
					...new Set(
						summary.members.flatMap((m) => m.lines.map((l) => l.currency)),
					),
				].sort(),
			);
			for (const [currency, breakdown] of Object.entries(plan.byCurrency)) {
				const scale = 10 ** currencyDecimals(currency);
				const fromSummary = Object.fromEntries(
					summary.members.map((m) => [
						m.key,
						m.lines.find((l) => l.currency === currency)?.balance ?? 0,
					]),
				);
				let sum = 0;
				for (const b of breakdown.balances) {
					const minor = Math.round(b.netBalance * scale);
					expect(
						minor,
						`${currency} ${refKey(b.participant)} in ledger ${n}`,
					).toBe(fromSummary[refKey(b.participant)]);
					sum += minor;
				}
				const imbalance =
					summary.imbalance.find((i) => i.currency === currency)?.minor ?? 0;
				expect(sum, `${currency} sum in ledger ${n}`).toBe(imbalance);
				// Shares cut down at 8 decimals never exceed their amount, so the
				// payer absorbs every rounding difference and nets add to zero.
				expect(imbalance, `${currency} imbalance in ledger ${n}`).toBe(0);
				expect(
					breakdown.plan.map((p) => [
						p.from.participantId,
						p.to.participantId,
						Math.round(p.amount * scale),
					]),
				).toEqual(
					summary.transfers
						.filter((t) => t.amount.currency === currency)
						.map((t) => [
							t.from.participantId,
							t.to.participantId,
							t.amount.minor,
						]),
				);
			}
		}
	});

	it("generates legacy rows that do not already sit on whole minor units", () => {
		const next = seeded(20261113);
		const shares = Array.from({ length: 50 }, () => randomLedger(next))
			.flatMap((l) => l.transactions)
			.flatMap((t) => t.splitParticipants)
			.map((sp) => String(sp.shareAmount));
		expect(shares.some((s) => /\.\d{3,}$/.test(s) && !/0{3,}$/.test(s))).toBe(
			true,
		);
	});
});
