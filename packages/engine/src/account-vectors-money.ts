/** The vectors about money: the lifecycle of an account, cents, liabilities, counted units and the day rule. See account-vectors.ts. */
import {
	type AccountVector,
	ARS,
	NOV10,
	NOV10_LATE,
	uuid,
} from "./account-vector-types";
import { rate, seed } from "./expense-create-vectors";
import { TOKYO } from "./recurring-vectors";

const [A1, L1, S1, S2] = [uuid(1), uuid(2), uuid(3), uuid(4)];

export const moneyVectors: AccountVector[] = [
	{
		// A USD account at blue. Created at 1,000: the account keeps rate 1 and
		// type blue, its snapshot is Nov 10 (the zone's day), no leg (the
		// opening balance is not a move). Net worth 1,000 x 1,545 = 1,545,000.00.
		// Balance to 1,200: Not logged +200, home 200 x 1,545 = 309,000, the
		// same day's snapshot becomes 1,200, the version stays (balance and a
		// kept type move nothing). Net worth 1,200 x 1,545 = 1,854,000.00.
		// Official from today: a switch row Nov 10 official after blue, the
		// account's type official (version 1). 1,200 x 1,050 = 1,260,000.00.
		// Closed at Buenos Aires 23:00 (UTC Nov 11): closedAt set (version 2),
		// a zero snapshot on the UTC day Nov 11, out of net worth. Closing a
		// closed account changes nothing; updating a closed one is refused.
		// Reopened 03:00Z the same UTC day: open again (version 3), Nov 11's
		// snapshot replaced by 1,200 at the account's type, net worth 1,260,000.00.
		// Reopening an open account changes nothing.
		name: "a USD account from create to reopen",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: A1,
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "1000",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: {
					done: {
						accounts: {
							[A1]: {
								balance: "1000",
								exchangeRate: "1",
								exchangeRateType: "blue",
								countedUnits: "0",
								closedAt: null,
								version: 0,
								name: "Wise",
							},
						},
						legCount: { [A1]: 0 },
						snapshots: [
							{
								accountId: A1,
								day: "2026-11-10",
								balance: "1000",
								exchangeRateType: "blue",
								usd: "1000.00",
							},
						],
						netWorth: 154_500_000,
					},
				},
			},
			{
				now: "2026-11-10T16:00:00Z",
				op: {
					kind: "accountBalance",
					body: { id: A1, balance: "1200", legId: L1, rateTypeId: S1 },
				},
				expect: {
					done: {
						accounts: {
							[A1]: { balance: "1200", exchangeRateType: "blue", version: 0 },
						},
						legs: {
							[L1]: {
								accountId: A1,
								amount: "200",
								homeAmount: "309000",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
						switchCount: { [A1]: 0 },
						snapshots: [
							{
								accountId: A1,
								day: "2026-11-10",
								balance: "1200",
								exchangeRateType: "blue",
								usd: "1200.00",
							},
						],
						netWorth: 185_400_000,
					},
				},
			},
			{
				now: "2026-11-10T17:00:00Z",
				op: {
					kind: "accountRateType",
					body: { id: A1, rateType: "official", rateTypeId: S2 },
				},
				expect: {
					done: {
						accounts: { [A1]: { exchangeRateType: "official", version: 1 } },
						switches: {
							[S2]: {
								accountId: A1,
								from: "2026-11-10",
								type: "official",
								previousType: "blue",
							},
						},
						netWorth: 126_000_000,
					},
				},
			},
			{
				now: NOV10_LATE,
				op: { kind: "accountClose", body: { id: A1 } },
				expect: {
					done: {
						accounts: {
							[A1]: { closedAt: "2026-11-11T02:00:00.000Z", version: 2 },
						},
						snapshots: [
							{
								accountId: A1,
								day: "2026-11-11",
								balance: "0",
								exchangeRateType: "official",
								usd: "0.00",
							},
						],
						netWorth: 0,
					},
				},
			},
			{
				now: "2026-11-11T02:30:00Z",
				op: { kind: "accountClose", body: { id: A1 } },
				expect: {
					done: {
						accounts: {
							[A1]: { closedAt: "2026-11-11T02:00:00.000Z", version: 2 },
						},
					},
				},
			},
			{
				now: "2026-11-11T02:45:00Z",
				op: {
					kind: "accountBalance",
					body: { id: A1, balance: "5", legId: uuid(5), rateTypeId: uuid(6) },
				},
				expect: { refused: "This account is closed. Reopen it to change it." },
			},
			{
				now: "2026-11-11T03:00:00Z",
				op: { kind: "accountReopen", body: { id: A1 } },
				expect: {
					done: {
						accounts: { [A1]: { closedAt: null, version: 3 } },
						snapshots: [
							{
								accountId: A1,
								day: "2026-11-11",
								balance: "1200",
								exchangeRateType: "official",
								recordedAt: "2026-11-11T03:00:00.000Z",
								usd: "1200.00",
							},
						],
						netWorth: 126_000_000,
					},
				},
			},
			{
				now: "2026-11-11T03:30:00Z",
				op: { kind: "accountReopen", body: { id: A1 } },
				expect: {
					done: {
						accounts: { [A1]: { closedAt: null, version: 3 } },
						snapshots: [
							{
								accountId: A1,
								day: "2026-11-11",
								balance: "1200",
								exchangeRateType: "official",
								recordedAt: "2026-11-11T03:00:00.000Z",
							},
						],
						netWorth: 126_000_000,
					},
				},
			},
		],
	},
];

const [A2, A3, A4, L2, L4] = [uuid(11), uuid(12), uuid(13), uuid(14), uuid(16)];

moneyVectors.push({
	// An ARS account at official (1,050): rate 1,050 stored, zero opening
	// balance, no leg. Balance to 1,544,996.25: Not logged +1,544,996.25 at
	// home 1:1 (the account is in the home currency). The snapshot's USD
	// value 1,544,996.25 / 1,050 = 1,471.425 is a tie that half to even
	// rounds to 1,471.42 (half up gives 1,471.43). A second account created
	// at 1,545,000.00 is 1,471.4285714... USD, not a tie, so 1,471.43.
	name: "an ARS account at official and the cents of its snapshot",
	seed: ARS,
	steps: [
		{
			now: NOV10,
			op: {
				kind: "accountCreate",
				body: {
					id: A2,
					name: "Cash",
					type: "CASH",
					currency: "ARS",
					balance: "0",
					rateType: "official",
					isLiquid: true,
				},
			},
			expect: {
				done: {
					accounts: {
						[A2]: {
							balance: "0",
							exchangeRate: "1050",
							exchangeRateType: "official",
							version: 0,
						},
					},
					snapshots: [
						{
							accountId: A2,
							day: "2026-11-10",
							balance: "0",
							exchangeRateType: "official",
							usd: "0.00",
						},
					],
				},
			},
		},
		{
			now: "2026-11-10T16:00:00Z",
			op: {
				kind: "accountBalance",
				body: {
					id: A2,
					balance: "1544996.25",
					legId: L2,
					rateTypeId: uuid(17),
				},
			},
			expect: {
				done: {
					accounts: { [A2]: { balance: "1544996.25", version: 0 } },
					legs: {
						[L2]: {
							accountId: A2,
							amount: "1544996.25",
							homeAmount: "1544996.25",
							homeCurrency: "ARS",
							date: "2026-11-10",
							source: "BALANCE_UPDATE",
						},
					},
					snapshots: [
						{
							accountId: A2,
							day: "2026-11-10",
							balance: "1544996.25",
							exchangeRateType: "official",
							usd: "1471.42",
						},
					],
					netWorth: 154_499_625,
				},
			},
		},
		{
			now: "2026-11-10T16:30:00Z",
			op: {
				kind: "accountCreate",
				body: {
					id: A3,
					name: "Savings",
					type: "CASH",
					currency: "ARS",
					balance: "1545000",
					rateType: "official",
					isLiquid: false,
				},
			},
			expect: {
				done: {
					snapshots: [
						{
							accountId: A3,
							day: "2026-11-10",
							balance: "1545000",
							exchangeRateType: "official",
							usd: "1471.43",
						},
					],
					netWorth: 308_999_625,
				},
			},
		},
	],
});

moneyVectors.push(
	{
		// A credit card owing 50,000 at official: net worth -50,000.00. Typing 30,000
		// is 20,000 paid down: worthOf a liability negates the difference
		// (30,000 - 50,000 = -20,000, so +20,000 in what you have), a positive
		// leg at home 1:1; the stored balance is 30,000, net worth -30,000.00.
		name: "a liability counts against you and paying it down is a positive leg",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: A4,
						name: "Visa",
						type: "LIABILITY_CREDIT_CARD",
						currency: "ARS",
						balance: "50000",
						rateType: "official",
						isLiquid: false,
					},
				},
				expect: { done: { netWorth: -5_000_000 } },
			},
			{
				now: "2026-11-10T16:00:00Z",
				op: {
					kind: "accountBalance",
					body: { id: A4, balance: "30000", legId: L4, rateTypeId: uuid(18) },
				},
				expect: {
					done: {
						accounts: { [A4]: { balance: "30000", countedUnits: "0" } },
						legs: {
							[L4]: {
								accountId: A4,
								amount: "20000",
								homeAmount: "20000",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
						netWorth: -3_000_000,
					},
				},
			},
		],
	},
	{
		// An account holding ARS 1,000 of which 600 units are counted by the
		// budget. Typing 400 is a leg of -600 (home 1:1); the counted units
		// never exceed the balance, so 600 becomes 400, and at 0 they go to 0.
		name: "counted units never exceed a hand-set balance",
		seed: ARS,
		accounts: [
			{
				id: uuid(30),
				name: "Wallet",
				type: "CASH",
				currency: "ARS",
				balance: "1000",
				exchangeRate: "1050",
				exchangeRateType: "official",
				countedUnits: "600",
			},
		],
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(30),
						balance: "400",
						legId: uuid(31),
						rateTypeId: uuid(32),
					},
				},
				expect: {
					done: {
						accounts: { [uuid(30)]: { balance: "400", countedUnits: "400" } },
						legs: {
							[uuid(31)]: {
								accountId: uuid(30),
								amount: "-600",
								homeAmount: "-600",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
					},
				},
			},
			{
				now: "2026-11-10T16:00:00Z",
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(30),
						balance: "0",
						legId: uuid(33),
						rateTypeId: uuid(34),
					},
				},
				expect: {
					done: {
						accounts: { [uuid(30)]: { balance: "0", countedUnits: "0" } },
						legCount: { [uuid(30)]: 2 },
					},
				},
			},
		],
	},
	{
		// Tokyo is UTC+9. 2026-03-10T16:00Z is Mar 11, 01:00 there. Created
		// then: the zone's day, Mar 11. Closed at the same instant: the UTC
		// day, Mar 10 (before the account opened, the owner question). Reopened
		// at 16:30Z: Mar 10's snapshot is replaced by the balance. A balance
		// update at 16:45Z is dated Mar 11 (the leg and the snapshot): +50
		// at blue, home 50 x 1,545 = 77,250.
		name: "the day rule per path in Tokyo",
		seed: seed("ARS", TOKYO, [
			rate("ARS", "blue", "1545", "2026-03-01T00:00:00Z"),
		]),
		steps: [
			{
				now: "2026-03-10T16:00:00Z",
				op: {
					kind: "accountCreate",
					body: {
						id: uuid(40),
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "100",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: {
					done: {
						snapshots: [
							{
								accountId: uuid(40),
								day: "2026-03-11",
								balance: "100",
								exchangeRateType: "blue",
								usd: "100.00",
							},
						],
					},
				},
			},
			{
				now: "2026-03-10T16:00:00Z",
				op: { kind: "accountClose", body: { id: uuid(40) } },
				expect: {
					done: {
						snapshots: [
							{
								accountId: uuid(40),
								day: "2026-03-10",
								balance: "0",
								exchangeRateType: "blue",
								usd: "0.00",
							},
						],
					},
				},
			},
			{
				now: "2026-03-10T16:30:00Z",
				op: { kind: "accountReopen", body: { id: uuid(40) } },
				expect: {
					done: {
						snapshots: [
							{
								accountId: uuid(40),
								day: "2026-03-10",
								balance: "100",
								exchangeRateType: "blue",
								usd: "100.00",
							},
						],
					},
				},
			},
			{
				now: "2026-03-10T16:45:00Z",
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(40),
						balance: "150",
						legId: uuid(41),
						rateTypeId: uuid(42),
					},
				},
				expect: {
					done: {
						legs: {
							[uuid(41)]: {
								accountId: uuid(40),
								amount: "50",
								homeAmount: "77250",
								homeCurrency: "ARS",
								date: "2026-03-11",
								source: "BALANCE_UPDATE",
							},
						},
						snapshots: [
							{
								accountId: uuid(40),
								day: "2026-03-11",
								balance: "150",
								exchangeRateType: "blue",
								usd: "150.00",
							},
							{
								accountId: uuid(40),
								day: "2026-03-10",
								balance: "100",
								exchangeRateType: "blue",
							},
						],
					},
				},
			},
		],
	},
);
