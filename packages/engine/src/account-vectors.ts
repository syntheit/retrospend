/**
 * Vectors for the account writes (create, edit, close, reopen, balance update,
 * rate type). Every expected value is derived by hand in the comment above it,
 * from the rules the server runs (accounts/manage.ts, checkpoint.ts,
 * rate-type.mutation.ts) and the domain's plans:
 *
 * - Home ARS, preferred type blue (1 USD = 1,545 ARS blue, 1,050 official),
 *   saved zone Buenos Aires (UTC-3, no DST). A rate is "units per USD".
 * - An account stores the rate of its type on the day it is written (1 for a
 *   USD account, whose type values the home side instead) and a USD account
 *   keeps the type it was asked for. A balance typed by hand is a Not logged
 *   leg for the difference, in what you have: a liability's balance counts
 *   against you, so paying it down is a positive leg. The leg's home value is
 *   the account's own rate type (a USD account at blue: 200 x 1,545 = 309,000).
 * - Days: create, edit and balance update date their snapshot and leg by the
 *   person's zone; close and reopen by the UTC day (an owner question, pinned).
 *   One snapshot per account per day: a second write that day replaces it.
 * - The version moves by 1 for each statement that changes type, currency,
 *   rate type, closedAt, inBudget, isLiquid, interestRate, minimumPayment or
 *   dueDate, or the stored rate while the type is custom. A balance, the
 *   counted units, a name and a same-type rate refresh never move it.
 *   (ACCOUNT_VERSION_COLUMNS.) The engine's number is a placeholder; the vectors
 *   hold the server to the same count.
 * - A net worth minor is the home amount x 100.
 *
 * The expected rows are compared by value, decimals as numbers and dates as
 * instants. `usd` is the snapshot's USD value, which only the server keeps.
 */
import type { AccountOp } from "./device/account-book";
import type { ExpenseSeed } from "./expense-create-conformance";
import { at, BA, rate, seed } from "./expense-create-vectors";
import { TOKYO } from "./recurring-vectors";

/** A client-made id as a uuid (v1 takes no other), numbered so a vector reads. */
export const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** An account the case starts with, as the server stores it (no legs, no snapshot). */
export interface SeedAccount {
	id: string;
	name: string;
	type: string;
	currency: string;
	balance: string;
	exchangeRate: string | null;
	exchangeRateType: string | null;
	countedUnits?: string;
	closedAt?: Date;
}

export interface ExpectedAccount {
	balance: string;
	exchangeRate: string | null;
	exchangeRateType: string | null;
	countedUnits: string;
	/** An instant, or null for open. */
	closedAt: string | null;
	currency: string;
	version: number;
	name: string;
}

export interface ExpectedLeg {
	accountId: string;
	amount: string;
	homeAmount: string | null;
	homeCurrency: string | null;
	/** The stored day. */
	date: string;
	source: string;
}

export interface ExpectedSnapshot {
	accountId: string;
	day: string;
	balance: string;
	exchangeRateType: string | null;
	/** The instant it was written; a write that changes nothing leaves it. */
	recordedAt?: string;
	/** The USD value; only the server's row keeps it. */
	usd?: string;
}

export interface ExpectedSwitch {
	accountId: string;
	from: string;
	type: string | null;
	previousType: string | null;
}

/** What a step leaves, by the id the vector names. Absent keys are not checked. */
export interface ExpectedState {
	accounts?: Record<string, Partial<ExpectedAccount>>;
	legs?: Record<string, ExpectedLeg>;
	/** How many legs each account has. */
	legCount?: Record<string, number>;
	snapshots?: ExpectedSnapshot[];
	switches?: Record<string, ExpectedSwitch>;
	/** How many rate switches each account has. */
	switchCount?: Record<string, number>;
	/** The home net worth minor. */
	netWorth?: number;
}

export type StepExpect =
	| { done: ExpectedState }
	/** The write is refused in these words and stores nothing. */
	| { refused: string }
	/** The device cannot book it and the server refuses it: no rate for these currencies. */
	| { missingRate: string[] };

export interface AccountStep {
	/** The instant the write runs at. */
	now: string;
	op: AccountOp;
	expect: StepExpect;
}

export interface AccountVector {
	name: string;
	seed: ExpenseSeed;
	accounts?: SeedAccount[];
	steps: AccountStep[];
}

const RATES = [
	rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
	rate("ARS", "official", "1050", "2026-11-01T00:00:00Z"),
];
const ARS = seed("ARS", BA, RATES);

const NOV10 = "2026-11-10T15:00:00Z"; // Buenos Aires Nov 10, 12:00
const NOV10_LATE = "2026-11-11T02:00:00Z"; // Buenos Aires Nov 10, 23:00; the UTC day is Nov 11

const [A1, L1, S1, S2] = [uuid(1), uuid(2), uuid(3), uuid(4)];

export const accountVectors: AccountVector[] = [
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

accountVectors.push({
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

accountVectors.push(
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

const [E1, E2] = [uuid(50), uuid(60)];

accountVectors.push(
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
);
