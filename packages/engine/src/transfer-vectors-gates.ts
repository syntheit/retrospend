/**
 * Vectors for what the device does not book: the budget gate (a crossing, a
 * budget it cannot read, a rate it lacks for the budget side), a missing rate,
 * and the refusals the route and the domain make. Each is derived by hand:
 *
 * - The budget line (MONEY-MOVES I14, I15): an account in the home currency
 *   of kind cash or card is in the budget, foreign money, investments and
 *   loans are out unless the account says otherwise (`inBudget`), and Not
 *   tracked is in only in the home currency. A move between an in and an out
 *   place crosses the line: "leaves" (from in to out) or "enters". The
 *   server's budget side lands in the book only when it has a default
 *   envelope and the amount is in the book's currency (the home currency): a
 *   book kept in USD records nothing, so such a move is the device's to book.
 * - The device books only when it reads the budget in full ("ready": it
 *   holds the book and a block made for it). A crossing into a home-currency
 *   book, a budget it cannot read and a budget effect with no rate are the
 *   server's: the write is refused (`online`) and stores nothing.
 * - The words of a refusal are the route's schema's, the domain's and the
 *   account rules'; nothing is stored.
 */
import {
	ACCOUNT_CLOSED,
	ACCOUNT_NOT_FOUND,
	MOVE_IN_FUTURE,
} from "@retrospend/domain/accounts/refusals";
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
	USD_OUT,
	ZZZ,
} from "./transfer-vectors-kit";

const t1 = idsOf(1);
const DAY = "2026-11-10";

const closedWallet = {
	...accounts.ars2,
	closedAt: new Date("2026-10-20T00:00:00Z"),
};

const refused = (message: string) => ({ refused: message });

export const gateVectors: TransferVector[] = [
	{
		// ARS 1,545,000 from an account in the budget to a USD account outside
		// it crosses the line (leaves, ARS 1,545,000). The book is in ARS, the
		// home currency, so the server records the budget side: not the device's.
		name: "a move crossing the line into a home-currency book is the server's",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.usdOut],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: USD_OUT,
					fromAmount: "1545000",
				}),
				expect: { online: "crosses_budget" },
			},
		],
	},
	{
		// The same move with a book kept in USD: the amount is in ARS, not the
		// book's currency, so nothing is recorded and the device books it.
		// 1,545,000 / 1,545 = USD 1,000.00 at the reference rate, the leg
		// books at official (1,000 x 1,050 = 1,050,000), balances 3,455,000 and
		// 50 + 1,000 = 1,050.
		name: "a crossing move into a book in another currency is booked",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.usdOut],
		budget: { currency: "USD" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: USD_OUT,
					fromAmount: "1545000",
				}),
				expect: {
					done: {
						legs: {
							[t1.to]: {
								accountId: USD_OUT,
								amount: "1000",
								currency: "USD",
								homeAmount: "1050000",
								homeCurrency: "ARS",
								source: "TRANSFER",
								date: DAY,
								transferId: t1.transfer,
								expenseId: null,
							},
						},
						accounts: {
							[ARS1]: { balance: "3455000", countedUnits: "0" },
							[USD_OUT]: { balance: "1050", countedUnits: "0" },
						},
					},
				},
			},
		],
	},
	{
		// A person with no budget (or one the device has not pulled whole):
		// whether a move crosses a line it cannot see is not for the device to say.
		name: "a device that cannot read the budget leaves every move to the server",
		seed: ARS_HOME,
		accounts: [accounts.ars1, accounts.ars2],
		budget: "none",
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "1000",
				}),
				expect: { online: "budget_not_ready" },
			},
		],
	},
	{
		// ZZZ has no rate anywhere. The source is in the budget and the
		// destination is not, so the move leaves it, and what leaves is the
		// source's home value, which no rate gives: the budget effect is
		// "unavailable", never zero. The server stores the move with no home
		// value on that leg and records nothing; the device leaves it.
		name: "a budget effect with no rate is the server's",
		seed: ARS_HOME,
		accounts: [accounts.zzz, accounts.usdOut],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ZZZ,
					toAccountId: USD_OUT,
					fromAmount: "500",
					toAmount: "10",
				}),
				expect: { online: "budget_unavailable" },
			},
		],
	},
	{
		// ARS to ZZZ with no typed amount: no rate values the arrival, so the
		// server asks for what arrived and the device cannot book it. Both name
		// ARS and ZZZ.
		name: "an exchange with no rate for the arrival is not booked",
		seed: ARS_HOME,
		accounts: [{ ...accounts.ars1, inBudget: false }],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ZZZ",
					fromAmount: "1000",
				}),
				expect: { missingRate: ["ARS", "ZZZ"] },
			},
		],
	},
	{
		// Each refusal is the route's or the domain's, in their words; nothing is
		// stored. A closed destination, a day after today in Buenos Aires, an
		// amount of zero (the schema), 9 decimals (the schema), an account the
		// person does not have, no place and no currency, a card payment to a
		// non-card, an ARS amount with 3 decimals, a fee of zero, and a delete of
		// a transfer that is not there.
		name: "refusals carry the route's and the domain's words",
		seed: ARS_HOME,
		accounts: [accounts.ars1, closedWallet],
		budget: { currency: "ARS" },
		steps: [
			{
				now: NOV10,
				op: create(1, {
					fromAccountId: ARS1,
					toAccountId: ARS2,
					fromAmount: "10",
				}),
				expect: refused(ACCOUNT_CLOSED),
			},
			{
				now: NOV10,
				op: create(2, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "10",
					date: "2026-11-11",
				}),
				expect: refused(MOVE_IN_FUTURE),
			},
			{
				now: NOV10,
				op: create(3, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "0",
				}),
				expect: refused("Must be above zero"),
			},
			{
				now: NOV10,
				op: create(4, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "1.123456789",
				}),
				expect: refused("Use digits and at most 8 decimals, like 1234.56"),
			},
			{
				now: NOV10,
				op: create(5, {
					fromAccountId: ARS1,
					toAccountId: "00000000-0000-4000-8000-000000000999",
					fromAmount: "10",
				}),
				expect: refused(ACCOUNT_NOT_FOUND),
			},
			{
				now: NOV10,
				op: create(6, {
					fromAccountId: ARS1,
					toAccountId: null,
					fromAmount: "10",
				}),
				expect: refused(
					"Pick an account or the currency of the money that is not tracked",
				),
			},
			{
				now: NOV10,
				op: create(7, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "10",
					kind: "CARD_PAYMENT",
				}),
				expect: refused("A card payment goes to a credit card"),
			},
			{
				now: NOV10,
				op: create(8, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "10.123",
				}),
				expect: refused("ARS has 2 decimals"),
			},
			{
				now: NOV10,
				op: create(9, {
					fromAccountId: ARS1,
					toAccountId: null,
					toCurrency: "ARS",
					fromAmount: "10",
					fee: { amount: "0" },
				}),
				expect: refused("Must be above zero"),
			},
			{
				now: NOV10,
				op: remove(99),
				expect: refused("Transfer not found"),
			},
		],
	},
];
