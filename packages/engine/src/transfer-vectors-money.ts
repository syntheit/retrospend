/**
 * Vectors for transfer create and delete that the device books. Every
 * expected value is derived by hand in the comment above it, from the rules
 * the server runs (transfers/create.mutation.ts, delete.mutation.ts) and the
 * domain's transferRows:
 *
 * - Home ARS (blue 1 USD = 1,545 ARS, official 1,050), saved zone Buenos Aires
 *   (UTC-3), the clock Nov 10 12:00 there. A leg is signed in what you have;
 *   its home value is the amount at the account's own rate type (a USD account
 *   at official books 1,050 per USD). An exchange with no typed amount arrives
 *   at the reference rate (the default pick, blue), to the destination's minor
 *   unit, half to even.
 * - A move is two legs (source, destination) and, with a fee, a third (FEE)
 *   plus the fee's own expense; the fee is valued at the day's rate of its
 *   account's currency, whatever rate the account stores. The fee expense is
 *   booked like any expense (the home's preferred type, blue): USD value at
 *   cents, home amount from one division.
 * - Counted units (D4) leave a source outside the budget and follow the money
 *   to another place outside it; a delete gives the source's back, takes the
 *   destination's away (never below zero) and caps both at what they hold.
 * - A net worth minor is the home amount x 100.
 * - The budget: these cases move between places on one side of the line (or
 *   a book in another currency), so the device books them. The cases the
 *   server books are in transfer-vectors-gates.ts.
 */
import type { TransferVector } from "./transfer-vector-types";
import {
	ARS_HOME,
	ARS1,
	ARS2,
	accounts,
	create,
	FEE_DAY,
	idsOf,
	NOV10,
	QQQ,
	remove,
	USD_BLUE,
	USD_COUNTED,
	USD_OFFICIAL,
	USD_OUT,
} from "./transfer-vectors-kit";

const DAY = "2026-11-10";

/** A transfer row as these cases store it: no fee, no counted units, no note. */
const row = (
	kind: string,
	from: string | null,
	fromAmount: string,
	to: string | null,
	toAmount: string,
	toCurrency: string,
) => ({
	kind,
	date: DAY,
	fromAccountId: from,
	fromAmount,
	toAccountId: to,
	toAmount,
	toCurrency,
	feeExpenseId: null,
	countedFromUnits: "0",
	countedToUnits: "0",
	note: null,
});

const leg = (
	transferId: string,
	accountId: string | null,
	currency: string,
	amount: string,
	home: string | null,
	source = "TRANSFER",
	expenseId: string | null = null,
) => ({
	accountId,
	amount,
	currency,
	homeAmount: home,
	homeCurrency: home === null ? null : "ARS",
	source,
	date: DAY,
	transferId,
	expenseId,
});

const t1 = idsOf(1);
const t2 = idsOf(2);
const t3 = idsOf(3);
const t4 = idsOf(4);

export const moneyVectors: TransferVector[] = [
	{
		// ARS 1,545,000 into a USD account at blue, no typed amount: 1,545,000 /
		// 1,545 = USD 1,000.00. Legs -1,545,000 ARS (home -1,545,000) and +1,000
		// USD (home 1,000 x 1,545 = 1,545,000), so net worth does not move:
		// before 5,000,000 + 2,000 x 1,545 = 8,090,000.00 and after 3,455,000 +
		// 3,000 x 1,545 = 8,090,000.00 (minor 809,000,000). Deleting it puts
		// the balances back (5,000,000 and 2,000) and takes the legs away.
		name: "an exchange at blue books the reference rate and deletes cleanly",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.usdBlue],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: USD_BLUE,
					fromAmount: "1545000",
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: row(
								"EXCHANGE",
								ARS1,
								"1545000",
								USD_BLUE,
								"1000",
								"USD",
							),
						},
						legs: {
							[t1.from]: leg(t1.transfer, ARS1, "ARS", "-1545000", "-1545000"),
							[t1.to]: leg(t1.transfer, USD_BLUE, "USD", "1000", "1545000"),
						},
						legCount: 2,
						accounts: {
							[ARS1]: { balance: "3455000", countedUnits: "0" },
							[USD_BLUE]: { balance: "3000", countedUnits: "0" },
						},
						netWorth: 809_000_000,
					},
				},
			},
			{
				now: NOV10,
				op: remove(1),
				expect: {
					done: {
						gone: { transfers: [t1.transfer], legs: [t1.from, t1.to] },
						legCount: 0,
						accounts: {
							[ARS1]: { balance: "5000000", countedUnits: "0" },
							[USD_BLUE]: { balance: "2000", countedUnits: "0" },
						},
						netWorth: 809_000_000,
					},
				},
			},
		],
	},
	{
		// Into a USD account at official with no typed amount it still arrives
		// at the reference rate, USD 1,000.00, but the leg books at the
		// account's own type: 1,000 x 1,050 = 1,050,000. Net worth: before
		// 5,000,000 + 500 x 1,050 = 5,525,000.00; after 3,455,000 + 1,500 x
		// 1,050 = 5,030,000.00, so it moves -495,000 (minor 503,000,000).
		// Then USD 1,471.43 typed for the same ARS 1,545,000: the leg books
		// 1,471.43 x 1,050 = 1,545,001.50 (the arrival is as typed), balances
		// 1,910,000 and 500 + 1,000 + 1,471.43 = 2,971.43, net worth 1,910,000
		// + 2,971.43 x 1,050 = 5,030,001.50 (minor 503,000,150).
		name: "into an account at official the leg books at its type, a typed amount as typed",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.usdOfficial],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: USD_OFFICIAL,
					fromAmount: "1545000",
				}),
				expect: {
					done: {
						legs: {
							[t1.to]: leg(t1.transfer, USD_OFFICIAL, "USD", "1000", "1050000"),
						},
						accounts: {
							[ARS1]: { balance: "3455000", countedUnits: "0" },
							[USD_OFFICIAL]: { balance: "1500", countedUnits: "0" },
						},
						netWorth: 503_000_000,
					},
				},
			},
			{
				now: NOV10,
				op: create(2, {
					fromAccountId: ARS1,
					toAccountId: USD_OFFICIAL,
					fromAmount: "1545000",
					toAmount: "1471.43",
				}),
				expect: {
					done: {
						transfers: {
							[t2.transfer]: row(
								"EXCHANGE",
								ARS1,
								"1545000",
								USD_OFFICIAL,
								"1471.43",
								"USD",
							),
						},
						legs: {
							[t2.to]: leg(
								t2.transfer,
								USD_OFFICIAL,
								"USD",
								"1471.43",
								"1545001.5",
							),
						},
						accounts: {
							[ARS1]: { balance: "1910000", countedUnits: "0" },
							[USD_OFFICIAL]: { balance: "2971.43", countedUnits: "0" },
						},
						netWorth: 503_000_150,
					},
				},
			},
		],
	},
	{
		// ARS 25.75 to Not tracked in JPY (the source is outside the budget, so
		// no line is crossed): at the reference rate 25.75 / 1,545 x 150 = 2.5
		// JPY, which has no decimals: half to even gives 2 (half up would give
		// 3). The JPY leg books 2 / 150 x 1,545 = 20.6 ARS at the day's rate,
		// the ARS leg -25.75; the Not tracked leg has no account.
		name: "an arrival that lands on half a unit rounds half to even",
		seed: ARS_HOME,
		accounts: [{ ...accounts.ars1, inBudget: false }],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "JPY",
					fromAmount: "25.75",
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: row("EXCHANGE", ARS1, "25.75", null, "2", "JPY"),
						},
						legs: {
							[t1.from]: leg(t1.transfer, ARS1, "ARS", "-25.75", "-25.75"),
							[t1.to]: leg(t1.transfer, null, "JPY", "2", "20.6"),
						},
						accounts: { [ARS1]: { balance: "4999974.25", countedUnits: "0" } },
					},
				},
			},
		],
	},
	{
		// A withdrawal into Not tracked, ARS 100,000: both places are in the
		// budget (Not tracked is, in the home currency), so nothing crosses. The
		// ARS account loses 100,000, the Not tracked leg (no account) gains it, and
		// net worth, which counts Not tracked money, does not move: 5,000,000.00
		// both before and after (minor 500,000,000).
		name: "a withdrawal into Not tracked keeps net worth",
		seed: ARS_HOME,
		accounts: [accounts.ars1],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "100000",
					kind: "WITHDRAWAL",
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: row(
								"WITHDRAWAL",
								ARS1,
								"100000",
								null,
								"100000",
								"ARS",
							),
						},
						legs: {
							[t1.to]: leg(t1.transfer, null, "ARS", "100000", "100000"),
						},
						accounts: { [ARS1]: { balance: "4900000", countedUnits: "0" } },
						netWorth: 500_000_000,
					},
				},
			},
		],
	},
	{
		// A fee of ARS 150 on the source: the FEE leg is -150 on the source and
		// the fee is an expense (title Fee, ARS 150: USD value 150 / 1,545 =
		// 0.0971 -> 0.10 at cents, rate 1,545 at blue, home amount 150.00, home
		// rate 1) dated the start of Nov 10 in Buenos Aires. The source ends at
		// 5,000,000 - 100,000 - 150 = 4,899,850, the destination at 200,000: net
		// worth 5,099,850.00 (minor 509,985,000). A delete takes the fee leg and the expense away with the rest.
		name: "a fee on the source is an expense and a FEE leg, gone with the move",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.ars2],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "100000",
					fee: { amount: "150" },
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: {
								...row("TRANSFER", ARS1, "100000", ARS2, "100000", "ARS"),
								feeExpenseId: t1.expense,
							},
						},
						legs: {
							[t1.fee]: leg(
								t1.transfer,
								ARS1,
								"ARS",
								"-150",
								"-150",
								"FEE",
								t1.expense,
							),
						},
						legCount: 3,
						expenses: {
							[t1.expense]: {
								title: "Fee",
								description: "Fee for a transfer",
								amount: "150",
								currency: "ARS",
								amountInUSD: "0.10",
								exchangeRate: "1545",
								rateType: "blue",
								homeCurrency: "ARS",
								homeRate: "1",
								homeAmount: "150.00",
								date: FEE_DAY,
							},
						},
						accounts: {
							[ARS1]: { balance: "4899850", countedUnits: "0" },
							[ARS2]: { balance: "200000", countedUnits: "0" },
						},
						netWorth: 509_985_000,
					},
				},
			},
			{
				now: NOV10,
				op: remove(1),
				expect: {
					done: {
						gone: {
							transfers: [t1.transfer],
							legs: [t1.from, t1.to, t1.fee],
							expenses: [t1.expense],
						},
						legCount: 0,
						accounts: {
							[ARS1]: { balance: "5000000", countedUnits: "0" },
							[ARS2]: { balance: "100000", countedUnits: "0" },
						},
						netWorth: 510_000_000,
					},
				},
			},
		],
	},
	{
		// A fee of 9 QQQ on another account: QQQ's day rate is 0.9 per USD
		// (the account stores a stale 0.5, which a fee must not use): 9 / 0.9 =
		// USD 10.00 x 1,545 = ARS 15,450.00. The FEE leg is -9 QQQ, home
		// -15,450; the expense is 9 QQQ, USD 10.00, rate 0.9, blue on the home
		// leg, home rate 1 / 0.9 x 1,545 = 1,716.666666666667 (12 decimals, half
		// to even), home amount 15,450.00. The QQQ account ends at 991.
		name: "a fee in a third currency is valued at the day's rate",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.ars2, accounts.qqq],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "300000",
					fee: { amount: "9", accountId: QQQ },
				}),
				expect: {
					done: {
						legs: {
							[t1.fee]: leg(
								t1.transfer,
								QQQ,
								"QQQ",
								"-9",
								"-15450",
								"FEE",
								t1.expense,
							),
						},
						expenses: {
							[t1.expense]: {
								title: "Fee",
								description: "Fee for a transfer",
								amount: "9",
								currency: "QQQ",
								amountInUSD: "10.00",
								exchangeRate: "0.9",
								rateType: "blue",
								homeCurrency: "ARS",
								homeRate: "1716.666666666667",
								homeAmount: "15450.00",
								date: FEE_DAY,
							},
						},
						accounts: {
							[ARS1]: { balance: "4700000", countedUnits: "0" },
							[ARS2]: { balance: "400000", countedUnits: "0" },
							[QQQ]: { balance: "991", countedUnits: "0" },
						},
					},
				},
			},
		],
	},
	{
		// Paying a loan of 1,000,000 with 200,000 is a debt payment: the loan
		// (a liability) stores what you owe, so its balance falls to 800,000 and
		// its leg is +200,000 in what you have. Net worth does not move: before
		// 5,000,000 - 1,000,000 = 4,000,000.00 and after 4,800,000 - 800,000 =
		// 4,000,000.00 (minor 400,000,000).
		name: "a debt payment keeps net worth",
		seed: ARS_HOME,
		accounts: [
			accounts.ars1,
			{
				id: ARS2,
				name: "Loan",
				type: "LIABILITY_LOAN",
				currency: "ARS",
				balance: "1000000",
				exchangeRate: null,
				exchangeRateType: null,
				inBudget: true,
			},
		],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "200000",
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: row(
								"DEBT_PAYMENT",
								ARS1,
								"200000",
								ARS2,
								"200000",
								"ARS",
							),
						},
						legs: {
							[t1.to]: leg(t1.transfer, ARS2, "ARS", "200000", "200000"),
						},
						accounts: {
							[ARS1]: { balance: "4800000", countedUnits: "0" },
							[ARS2]: { balance: "800000", countedUnits: "0" },
						},
						netWorth: 400_000_000,
					},
				},
			},
		],
	},
	{
		// USD 300 from an account outside the budget that holds 300 counted
		// units, into an ARS account in it (an exchange at the reference rate:
		// 300 x 1,545 = ARS 463,500.00). The money entering the budget was all
		// counted already, so the budget's side is "counted" and nothing is
		// recorded: the move takes min(300, 300) = 300 counted units from the
		// source (counted 0, balance 500 - 300 = 200) and the destination gets
		// none (it is in the budget). Legs: -300 USD at official (-315,000 ARS),
		// +463,500 ARS. A delete gives the 300 back: counted 0 + 300 = 300, capped at
		// the balance 500 it holds again: 300.
		name: "a counted move gives its units back on delete",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.usdCounted],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: USD_COUNTED,
					toAccountId: ARS1,
					fromAmount: "300",
				}),
				expect: {
					done: {
						transfers: {
							[t1.transfer]: {
								...row("EXCHANGE", USD_COUNTED, "300", ARS1, "463500", "ARS"),
								countedFromUnits: "300",
							},
						},
						legs: {
							[t1.from]: leg(
								t1.transfer,
								USD_COUNTED,
								"USD",
								"-300",
								"-315000",
							),
							[t1.to]: leg(t1.transfer, ARS1, "ARS", "463500", "463500"),
						},
						accounts: {
							[USD_COUNTED]: { balance: "200", countedUnits: "0" },
							[ARS1]: { balance: "5463500", countedUnits: "0" },
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
							[USD_COUNTED]: { balance: "500", countedUnits: "300" },
							[ARS1]: { balance: "5000000", countedUnits: "0" },
						},
					},
				},
			},
		],
	},
	{
		// USD 100 between two accounts outside the budget (no line crossed),
		// the source holding 300 counted units: the move takes min(300, 100) =
		// 100 and the destination gets 100 x 100 / 100 = 100 (capped at the
		// balance it holds, 50 + 100 = 150: 100). After: source balance 400,
		// counted 200; destination balance 150, counted 100. A delete: the legs
		// reverse (the destination's 150 -> 50 caps its counted at 50), the
		// source's counted gets 100 back (300), the destination's loses 100 and
		// stops at zero: balances 500 and 50, counted 300 and 0.
		name: "counted units follow the money between accounts outside the budget",
		seed: ARS_HOME,
		accounts: [accounts.usdCounted, accounts.usdOut],
		budget: { currency: "ARS" },
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
						transfers: {
							[t1.transfer]: {
								...row("TRANSFER", USD_COUNTED, "100", USD_OUT, "100", "USD"),
								countedFromUnits: "100",
								countedToUnits: "100",
							},
						},
						accounts: {
							[USD_COUNTED]: { balance: "400", countedUnits: "200" },
							[USD_OUT]: { balance: "150", countedUnits: "100" },
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
							[USD_COUNTED]: { balance: "500", countedUnits: "300" },
							[USD_OUT]: { balance: "50", countedUnits: "0" },
						},
					},
				},
			},
		],
	},
	{
		// A third and fourth move on the same accounts keep their own ids:
		// the second transfer's legs and fee are not the first's.
		name: "two moves in a row keep their own rows",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.ars2],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(3, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "1000",
					note: "Rent split",
				}),
				expect: {
					done: {
						transfers: {
							[t3.transfer]: {
								...row("TRANSFER", ARS1, "1000", ARS2, "1000", "ARS"),
								note: "Rent split",
							},
						},
						legCount: 2,
					},
				},
			},
			{
				now: NOV10,
				op: create(4, {
					fromAccountId: ARS2,
					toAccountId: ARS1,
					fromAmount: "250",
				}),
				expect: {
					done: {
						legs: { [t4.from]: leg(t4.transfer, ARS2, "ARS", "-250", "-250") },
						legCount: 4,
						accounts: {
							[ARS1]: { balance: "4999250", countedUnits: "0" },
							[ARS2]: { balance: "100750", countedUnits: "0" },
						},
					},
				},
			},
		],
	},
];
