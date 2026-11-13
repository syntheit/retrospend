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
	computePeriodOutstanding,
	computeSettlementPlan,
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
