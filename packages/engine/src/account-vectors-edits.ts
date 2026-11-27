/** The vectors about edits, refusals and missing rates. See account-vectors.ts. */
import { type AccountVector, ARS, NOV10, uuid } from "./account-vector-types";
import { at } from "./expense-create-vectors";

const [E1, E2] = [uuid(50), uuid(60)];

export const editVectors: AccountVector[] = [
	{
		// A USD account at blue, 1,000, then +100: one leg. Once money moved
		// through it, neither its currency nor which side of net worth it is on
		// can change (refused, in the server's words). An edit that keeps both
		// writes the columns (isLiquid off and "part of my budget" on: version 1),
		// then the dated switch blue to official (version 2; a rename moves
		// nothing); the balance is unchanged, so no new leg and the day's
		// snapshot is replaced at official.
		name: "an edit refuses what legs pin and bumps the version per statement",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: E1,
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "1000",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: { done: { accounts: { [E1]: { version: 0 } } } },
			},
			{
				now: "2026-11-10T16:00:00Z",
				op: {
					kind: "accountBalance",
					body: {
						id: E1,
						balance: "1100",
						legId: uuid(51),
						rateTypeId: uuid(52),
					},
				},
				expect: {
					done: { legCount: { [E1]: 1 }, accounts: { [E1]: { version: 0 } } },
				},
			},
			{
				now: "2026-11-10T16:30:00Z",
				op: {
					kind: "accountUpdate",
					body: {
						id: E1,
						name: "Wise",
						type: "CASH",
						currency: "ARS",
						balance: "1100",
						rateType: "official",
						isLiquid: true,
						legId: uuid(53),
						rateTypeId: uuid(54),
					},
				},
				expect: {
					refused:
						"Money moved through this account in its currency. Add a new account instead.",
				},
			},
			{
				now: "2026-11-10T16:35:00Z",
				op: {
					kind: "accountUpdate",
					body: {
						id: E1,
						name: "Wise",
						type: "LIABILITY_LOAN",
						currency: "USD",
						balance: "1100",
						rateType: "official",
						isLiquid: true,
						legId: uuid(53),
						rateTypeId: uuid(54),
					},
				},
				expect: {
					refused:
						"Money moved through this account as something you have or owe. Add a new account instead.",
				},
			},
			{
				now: "2026-11-10T17:00:00Z",
				op: {
					kind: "accountUpdate",
					body: {
						id: E1,
						name: "Wise USD",
						type: "CASH",
						currency: "USD",
						balance: "1100",
						rateType: "official",
						isLiquid: false,
						inBudget: true,
						legId: uuid(53),
						rateTypeId: uuid(54),
					},
				},
				expect: {
					done: {
						accounts: {
							[E1]: {
								name: "Wise USD",
								balance: "1100",
								exchangeRate: "1",
								exchangeRateType: "official",
								version: 2,
							},
						},
						legCount: { [E1]: 1 },
						switches: {
							[uuid(54)]: {
								accountId: E1,
								from: "2026-11-10",
								type: "official",
								previousType: "blue",
							},
						},
						snapshots: [
							{
								accountId: E1,
								day: "2026-11-10",
								balance: "1100",
								exchangeRateType: "official",
								usd: "1100.00",
							},
						],
						netWorth: 115_500_000,
					},
				},
			},
		],
	},
	{
		// No legs yet, so the currency may change. USD blue 1,000 edited to an
		// ARS account of 500 at official: the columns change currency (version
		// 1), the resolved ARS rate is official 1,050 (not blue), a different
		// type from the stored blue, so a switch Nov 10 official after blue
		// (version 2), then a checkpoint: -500 in what you have (the account is
		// ARS now), home 1:1, balance 500, rate 1,050, snapshot replaced.
		// Net worth ARS 500.00.
		name: "an edit with no legs may change the currency",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: E2,
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "1000",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: { done: {} },
			},
			{
				now: "2026-11-10T16:00:00Z",
				op: {
					kind: "accountUpdate",
					body: {
						id: E2,
						name: "Wise",
						type: "CASH",
						currency: "ARS",
						balance: "500",
						rateType: "official",
						isLiquid: true,
						legId: uuid(61),
						rateTypeId: uuid(62),
					},
				},
				expect: {
					done: {
						accounts: {
							[E2]: {
								currency: "ARS",
								balance: "500",
								exchangeRate: "1050",
								exchangeRateType: "official",
								version: 2,
							},
						},
						legs: {
							[uuid(61)]: {
								accountId: E2,
								amount: "-500",
								homeAmount: "-500",
								homeCurrency: "ARS",
								date: "2026-11-10",
								source: "BALANCE_UPDATE",
							},
						},
						switches: {
							[uuid(62)]: {
								accountId: E2,
								from: "2026-11-10",
								type: "official",
								previousType: "blue",
							},
						},
						snapshots: [
							{
								accountId: E2,
								day: "2026-11-10",
								balance: "500",
								exchangeRateType: "official",
								usd: "0.48",
							},
						],
						netWorth: 50_000,
					},
				},
			},
		],
	},
	{
		// Refusals, in the server's words, each writing nothing: an account the
		// person does not have (the balance, edit and rate type say "Account not
		// found", close says "Asset not found"), a rate type dated tomorrow in
		// Buenos Aires, and a USD amount of 3 decimals (never rounded).
		name: "refusals match the server's words",
		seed: ARS,
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: uuid(70),
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "10",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: { done: {} },
			},
			{
				now: NOV10,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(71),
						balance: "1",
						legId: uuid(72),
						rateTypeId: uuid(73),
					},
				},
				expect: { refused: "Account not found" },
			},
			{
				now: NOV10,
				op: { kind: "accountClose", body: { id: uuid(71) } },
				expect: { refused: "Asset not found" },
			},
			{
				now: NOV10,
				op: { kind: "accountReopen", body: { id: uuid(71) } },
				expect: { refused: "Asset not found" },
			},
			{
				now: NOV10,
				op: {
					kind: "accountRateType",
					body: { id: uuid(71), rateType: "blue", rateTypeId: uuid(74) },
				},
				expect: { refused: "Account not found" },
			},
			{
				now: NOV10,
				op: {
					kind: "accountRateType",
					body: {
						id: uuid(70),
						rateType: "official",
						from: "2026-11-11",
						rateTypeId: uuid(75),
					},
				},
				expect: { refused: "A money move cannot be dated in the future" },
			},
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: uuid(78),
						name: "Wise",
						type: "CASH",
						currency: "USD",
						balance: "10.123",
						rateType: "blue",
						isLiquid: true,
					},
				},
				expect: {
					refused: "balance 10.123 has more decimals than USD allows (2)",
				},
			},
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: uuid(79),
						name: "Visa",
						type: "LIABILITY_CREDIT_CARD",
						currency: "USD",
						balance: "10",
						rateType: "blue",
						isLiquid: false,
						minimumPayment: "1.234",
					},
				},
				expect: {
					refused: "minimumPayment 1.234 has more decimals than USD allows (2)",
				},
			},
			{
				now: NOV10,
				op: {
					kind: "accountBalance",
					body: {
						id: uuid(70),
						balance: "10.123",
						legId: uuid(76),
						rateTypeId: uuid(77),
					},
				},
				expect: {
					refused: "balance 10.123 has more decimals than USD allows (2)",
				},
			},
		],
	},
	{
		// BRL has no rate in the table, so an account in it cannot be stored (the
		// server answers 400; the device cannot book it and says so). An account
		// with no stored rate reopens when its balance is zero (nothing to
		// value), and refuses a balance of 100 it cannot value, never at 1.
		name: "a missing rate is never 1",
		seed: ARS,
		accounts: [
			{
				id: uuid(80),
				name: "Zero",
				type: "CASH",
				currency: "BRL",
				balance: "0",
				exchangeRate: null,
				exchangeRateType: null,
				closedAt: at("2026-11-01T12:00:00Z"),
			},
			{
				id: uuid(81),
				name: "Held",
				type: "CASH",
				currency: "BRL",
				balance: "100",
				exchangeRate: null,
				exchangeRateType: null,
				closedAt: at("2026-11-01T12:00:00Z"),
			},
		],
		steps: [
			{
				now: NOV10,
				op: {
					kind: "accountCreate",
					body: {
						id: uuid(82),
						name: "Nubank",
						type: "CASH",
						currency: "BRL",
						balance: "100",
						isLiquid: true,
					},
				},
				expect: { missingRate: ["BRL"] },
			},
			{
				now: NOV10,
				op: { kind: "accountReopen", body: { id: uuid(81) } },
				expect: { missingRate: ["BRL"] },
			},
			{
				now: NOV10,
				op: { kind: "accountReopen", body: { id: uuid(80) } },
				expect: {
					done: {
						accounts: { [uuid(80)]: { closedAt: null, version: 1 } },
						snapshots: [
							{
								accountId: uuid(80),
								day: "2026-11-10",
								balance: "0",
								exchangeRateType: null,
								usd: "0.00",
							},
						],
					},
				},
			},
		],
	},
];
