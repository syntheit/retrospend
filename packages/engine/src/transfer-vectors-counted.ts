/**
 * Vectors for the counted units of a delete (D4) where the floor and the cap
 * each bind, reached by moves in production order (never by editing a row).
 * Home ARS (blue 1,545, official 1,050), a book kept in USD so a move across
 * the line is the device's to book (nothing is recorded: the amount is in ARS).
 *
 * A source outside the budget gives counted units away first, up to the
 * amount moved (cappedCounted); money into a place outside the budget carries
 * them along. A delete gives the source's back (an increment), takes the
 * destination's away with a floor at zero (GREATEST), and caps each account at
 * what it holds (nothing when its balance is 0 or less).
 */
import type { TransferVector } from "./transfer-vector-types";
import {
	ARS_HOME,
	ARS1,
	ARS2,
	accounts,
	create,
	idsOf,
	NOV10,
	remove,
	USD_COUNTED,
	USD_OUT,
} from "./transfer-vectors-kit";

const t1 = idsOf(1);
const t3 = idsOf(3);

const held = (balance: string, countedUnits: string) => ({
	balance,
	countedUnits,
});

export const countedVectors: TransferVector[] = [
	{
		// Seed: A holds USD 500 with 300 counted units, B USD 50 with none, both
		// outside the budget.
		// 1. USD 100 A -> B: 100 counted units go along (min(300, 100); B gets
		//    100 x 100 / 100). A 400 / 200, B 150 / 100.
		// 2. ARS 1,545,000 -> B (arrives at the reference rate: 1,000 USD): a
		//    wallet's money holds no counted units. B 1,150 / 100.
		// 3. USD 80 B -> a wallet in the budget (80 x 1,545 = ARS 123,600): all
		//    80 are counted, so min(100, 80) = 80 leave B. B 1,070 / 20, wallet
		//    223,600.
		// 4. Delete 1: the legs reverse (B 1,070 - 100 = 970, its 20 counted
		//    units fit), A gets 100 back (200 + 100 = 300, under 500), B gives
		//    100 back: 20 - 100 = -80, floored at 0. Without the floor B would
		//    hold -80 counted units (the cap keeps a negative). A 500 / 300,
		//    B 970 / 0.
		name: "a delete takes the destination's counted units away, never below zero",
		seed: ARS_HOME,
		accounts: [
			accounts.usdCounted,
			accounts.usdOut,
			accounts.ars1,
			accounts.ars2,
		],
		budget: { currency: "USD" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: USD_COUNTED,
					toAccountId: USD_OUT,
					fromAmount: "100",
				}),
				expect: {
					done: {
						accounts: {
							[USD_COUNTED]: held("400", "200"),
							[USD_OUT]: held("150", "100"),
						},
					},
				},
			},
			{
				now: NOV10,
				op: create(2, {
					fromAccountId: ARS1,
					toAccountId: USD_OUT,
					fromAmount: "1545000",
				}),
				expect: {
					done: {
						accounts: {
							[ARS1]: held("3455000", "0"),
							[USD_OUT]: held("1150", "100"),
						},
					},
				},
			},
			{
				now: NOV10,
				op: create(3, {
					fromAccountId: USD_OUT,
					toAccountId: ARS2,
					fromAmount: "80",
				}),
				expect: {
					done: {
						transfers: {
							[t3.transfer]: {
								kind: "EXCHANGE",
								date: "2026-11-10",
								fromAccountId: USD_OUT,
								fromAmount: "80",
								toAccountId: ARS2,
								toAmount: "123600",
								toCurrency: "ARS",
								feeExpenseId: null,
								countedFromUnits: "80",
								countedToUnits: "0",
								note: null,
							},
						},
						accounts: {
							[USD_OUT]: held("1070", "20"),
							[ARS2]: held("223600", "0"),
						},
					},
				},
			},
			{
				now: NOV10,
				op: remove(1),
				expect: {
					done: {
						gone: { transfers: [t1.transfer] },
						accounts: {
							[USD_COUNTED]: held("500", "300"),
							[USD_OUT]: held("970", "0"),
						},
					},
				},
			},
		],
	},
	{
		// Seed as above (A USD 500 / 300 counted, B USD 50 / none; a wallet).
		// 1. USD 100 A -> B: A 400 / 200, B 150 / 100.
		// 2. USD 450 A -> the wallet (450 x 1,545 = ARS 695,250): the 200 counted
		//    units leave first (min(200, 450)), the rest is fresh money into the
		//    budget. A is overdrawn: 400 - 450 = -50, counted 0 (nothing counts
		//    at a balance of 0 or less). Wallet 5,695,250.
		// 3. Delete 1: A's leg reverses: -50 + 100 = 50 (counted 0 fits). A gets
		//    its 100 back: 0 + 100 = 100, but it holds only 50: capped at 50.
		//    Without the cap it would hold 100 counted units of 50. B's leg
		//    reverses (150 - 100 = 50; counted 100 -> 50 by the leg's cap), then
		//    it gives 100 back: 50 - 100 floored at 0. A 50 / 50, B 50 / 0.
		name: "a delete caps the source's counted units at what it holds",
		seed: ARS_HOME,
		accounts: [accounts.usdCounted, accounts.usdOut, accounts.ars1],
		budget: { currency: "USD" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: USD_COUNTED,
					toAccountId: USD_OUT,
					fromAmount: "100",
				}),
				expect: {
					done: {
						accounts: {
							[USD_COUNTED]: held("400", "200"),
							[USD_OUT]: held("150", "100"),
						},
					},
				},
			},
			{
				now: NOV10,
				op: create(5, {
					fromAccountId: USD_COUNTED,
					toAccountId: ARS1,
					fromAmount: "450",
				}),
				expect: {
					done: {
						accounts: {
							[USD_COUNTED]: held("-50", "0"),
							[ARS1]: held("5695250", "0"),
						},
					},
				},
			},
			{
				now: NOV10,
				op: remove(1),
				expect: {
					done: {
						accounts: {
							[USD_COUNTED]: held("50", "50"),
							[USD_OUT]: held("50", "0"),
						},
					},
				},
			},
		],
	},
];
