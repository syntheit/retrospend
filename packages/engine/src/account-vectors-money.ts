/** The vectors about money: cents, liabilities, counted units and the day rule. See account-vectors.ts. */
import { type AccountVector, ARS, NOV10, uuid } from "./account-vector-types";
import { rate, seed } from "./expense-create-vectors";
import { TOKYO } from "./recurring-vectors";

const [A2, A3, A4, L2, L4] = [uuid(11), uuid(12), uuid(13), uuid(14), uuid(16)];

export const moneyVectors: AccountVector[] = [
	{
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
	},

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
];
