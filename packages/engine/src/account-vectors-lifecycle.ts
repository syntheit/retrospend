/** The lifecycle of a USD account from create to reopen. See account-vectors.ts. */
import {
	type AccountVector,
	ARS,
	NOV10,
	NOV10_LATE,
	uuid,
} from "./account-vector-types";

const [A1, L1, S1, S2] = [uuid(1), uuid(2), uuid(3), uuid(4)];

export const lifecycleVectors: AccountVector[] = [
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
