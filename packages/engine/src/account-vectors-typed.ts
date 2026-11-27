/**
 * The vectors about the rate type "custom", a typed rate and typed terms.
 * See account-vectors.ts for the rules.
 *
 * - A custom rate is the one the person typed and the account keeps it as
 *   typed: 1 USD = 5.5 BRL. A BRL account of 100 is 100 x 1,545 / 5.5 =
 *   28,090.909... ARS at home, one division, so 28,090.91 (minor 2,809,091).
 * - For the custom type the stored rate is part of the account: changing it
 *   moves the version (+1); for a table type it is a cache and never does.
 * - A balance update that names no rate and no type keeps the account's own:
 *   the stored custom rate is used, not looked up (BRL has no table row).
 * - The route checks a body against its schema first (the digits of a
 *   balance, the decimals of a rate, a percent) and then the typed numbers
 *   (the digits a double can hold); the device refuses in the same words.
 */
import { type AccountVector, ARS, NOV10, uuid } from "./account-vector-types";
import { at } from "./expense-create-vectors";

const BRL = uuid(100);
const NOV10_LATER = "2026-11-10T16:00:00Z";

const newAccount = (over: Record<string, unknown>) =>
	({
		kind: "accountCreate",
		body: {
			id: uuid(190),
			name: "Acct",
			type: "CASH",
			currency: "USD",
			balance: "10",
			rateType: "blue",
			isLiquid: true,
			...over,
		},
	}) as const;

export const typedVectors: AccountVector[] = [
	{
		// BRL has no table rate; the account carries a typed one, 5.5. Balance 100:
		// net worth 100 x 1,545 / 5.5 = 28,090.91 ARS, the snapshot 100 / 5.5 =
		// 18.18 USD, version 0. Balance 110 at a typed 5.6: the rate is part of
		// the account, so the version is 1; the leg is +10, worth 10 x 1,545 /
		// 5.6 = 2,758.92857142857... ARS, kept at 8 decimals: 2758.92857143.
		// Balance 120 naming neither a type nor a rate keeps the stored 5.6 (the
		// device must not look BRL up in the table): +10 again at 5.6, the
		// version stays. An edit gives it terms and a new typed rate 6: the
		// columns change (interest 24.5, payment 10.5, due day 15: version 2),
		// the rate type is still custom so no switch, the checkpoint stores 6 for
		// the custom type (version 3), balance unchanged so no leg. Net worth
		// 120 x 1,545 / 6 = 30,900.00.
		name: "a custom rate is kept as typed, and moves the version",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: newAccount({
					id: BRL,
					name: "Nubank",
					currency: "BRL",
					balance: "100",
					rateType: "custom",
					exchangeRate: "5.5",
				}),
				expect: {
					done: {
						accounts: {
							[BRL]: {
								balance: "100",
								exchangeRate: "5.5",
								exchangeRateType: "custom",
								version: 0,
							},
						},
						snapshots: [
							{
								accountId: BRL,
								day: "2026-11-10",
								balance: "100",
								exchangeRateType: "custom",
								usd: "18.18",
							},
						],
						netWorth: 2_809_091,
					},
				},
			},
			{
				now: NOV10_LATER,
				op: {
					kind: "accountBalance",
					body: {
						id: BRL,
						balance: "110",
						rateType: "custom",
						exchangeRate: "5.6",
						legId: uuid(101),
						rateTypeId: uuid(102),
					},
				},
				expect: {
					done: {
						accounts: { [BRL]: { exchangeRate: "5.6", version: 1 } },
						legs: {
							[uuid(101)]: {
								accountId: BRL,
								amount: "10",
								homeAmount: "2758.92857143",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
						switchCount: { [BRL]: 0 },
					},
				},
			},
			{
				now: "2026-11-10T17:00:00Z",
				op: {
					kind: "accountBalance",
					body: {
						id: BRL,
						balance: "120",
						legId: uuid(103),
						rateTypeId: uuid(104),
					},
				},
				expect: {
					done: {
						accounts: {
							[BRL]: {
								balance: "120",
								exchangeRate: "5.6",
								exchangeRateType: "custom",
								version: 1,
							},
						},
						legs: {
							[uuid(103)]: {
								accountId: BRL,
								amount: "10",
								homeAmount: "2758.92857143",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
					},
				},
			},
			{
				now: "2026-11-10T18:00:00Z",
				op: {
					kind: "accountUpdate",
					body: {
						id: BRL,
						name: "Nubank",
						type: "CASH",
						currency: "BRL",
						balance: "120",
						rateType: "custom",
						exchangeRate: "6",
						isLiquid: true,
						interestRate: "24.5",
						minimumPayment: "10.5",
						dueDay: 15,
						legId: uuid(105),
						rateTypeId: uuid(106),
					},
				},
				expect: {
					done: {
						accounts: {
							[BRL]: {
								exchangeRate: "6",
								interestRate: "24.5",
								minimumPayment: "10.5",
								dueDate: 15,
								version: 3,
							},
						},
						legCount: { [BRL]: 2 },
						switchCount: { [BRL]: 0 },
						netWorth: 3_090_000,
					},
				},
			},
		],
	},
	{
		// A loan owing ARS 100,000 at official with its terms: interest 24.5,
		// minimum payment 1,500.5, due on the 5th, as typed (version 0). An edit
		// that moves the interest to 25 and the due day to 6 changes columns in
		// one statement: version 1. Net worth -100,000.00.
		name: "a liability's terms are written as typed and move the version",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: newAccount({
					id: uuid(110),
					name: "Loan",
					type: "LIABILITY_LOAN",
					currency: "ARS",
					balance: "100000",
					rateType: "official",
					isLiquid: false,
					interestRate: "24.5",
					minimumPayment: "1500.5",
					dueDay: 5,
				}),
				expect: {
					done: {
						accounts: {
							[uuid(110)]: {
								interestRate: "24.5",
								minimumPayment: "1500.5",
								dueDate: 5,
								version: 0,
							},
						},
						netWorth: -10_000_000,
					},
				},
			},
			{
				now: NOV10_LATER,
				op: {
					kind: "accountUpdate",
					body: {
						id: uuid(110),
						name: "Loan",
						type: "LIABILITY_LOAN",
						currency: "ARS",
						balance: "100000",
						rateType: "official",
						isLiquid: false,
						interestRate: "25",
						minimumPayment: "1500.5",
						dueDay: 6,
						legId: uuid(111),
						rateTypeId: uuid(112),
					},
				},
				expect: {
					done: {
						accounts: {
							[uuid(110)]: {
								interestRate: "25",
								minimumPayment: "1500.5",
								dueDate: 6,
								version: 1,
							},
						},
						legCount: { [uuid(110)]: 0 },
					},
				},
			},
		],
	},
	{
		// A USD account at blue 1,000, then one update that says 1,100 and
		// official: the type switches from today (previous blue) and the leg is
		// +100 booked at the type the account ends with, official: 100 x 1,050 =
		// 105,000. Version 1 (the type). Net worth 1,100 x 1,050 = 1,155,000.00.
		name: "a balance update that changes the rate type and the balance",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: newAccount({ id: uuid(120), name: "Wise", balance: "1000" }),
				expect: { done: {} },
			},
			{
				now: NOV10_LATER,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(120),
						balance: "1100",
						rateType: "official",
						legId: uuid(121),
						rateTypeId: uuid(122),
					},
				},
				expect: {
					done: {
						accounts: {
							[uuid(120)]: {
								balance: "1100",
								exchangeRateType: "official",
								version: 1,
							},
						},
						legs: {
							[uuid(121)]: {
								accountId: uuid(120),
								amount: "100",
								homeAmount: "105000",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
						switches: {
							[uuid(122)]: {
								accountId: uuid(120),
								from: "2026-11-10",
								type: "official",
								previousType: "blue",
							},
						},
						snapshots: [
							{
								accountId: uuid(120),
								day: "2026-11-10",
								balance: "1100",
								exchangeRateType: "official",
							},
						],
						netWorth: 115_500_000,
					},
				},
			},
		],
	},
	{
		// A closed BRL account whose type is blue has no table rate to value
		// 100 with, so reopening falls back to the rate stored on it, 5.5:
		// 100 / 5.5 = 18.18 USD in the snapshot, the type kept.
		name: "reopen falls back to the stored rate",
		seed: ARS,
		accounts: [
			{
				id: uuid(130),
				name: "Old",
				type: "CASH",
				currency: "BRL",
				balance: "100",
				exchangeRate: "5.5",
				exchangeRateType: "blue",
				closedAt: at("2026-11-01T12:00:00Z"),
			},
		],
		steps: [
			{
				now: NOV10,
				op: { kind: "accountReopen", body: { id: uuid(130) } },
				expect: {
					done: {
						accounts: { [uuid(130)]: { closedAt: null, version: 1 } },
						snapshots: [
							{
								accountId: uuid(130),
								day: "2026-11-10",
								balance: "100",
								exchangeRateType: "blue",
								usd: "18.18",
							},
						],
					},
				},
			},
		],
	},
];
