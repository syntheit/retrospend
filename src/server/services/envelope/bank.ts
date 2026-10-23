/**
 * "Does this match your bank?" (D16 c, SPEC §5.11): what the budget holds
 * (To assign + Σ Left + assigned to next month, the invariant's left side)
 * against the Wealth accounts that are part of the budget (MONEY-MOVES §2.1:
 * by default cash and bank accounts and cards in the book currency; a card
 * balance counts against you). Money people owe you is in neither and is
 * shown apart. Accounts in another currency are valued at today's rate; one
 * without a rate is listed with no value and the check is incomplete (R14).
 * Welcome back's "Set what I have now" uses the same numbers as its prefill.
 */
import type { BankSide } from "~/lib/schemas/envelope-book";
import type { Prisma } from "~prisma";
import { inBudget, worthOf } from "../accounts/places";
import { addDays, addMonths } from "./calendar";
import { computeBook, sumLeft } from "./engine";
import type { MonthRead } from "./month-read";
import { RateBook } from "./rate-book";
import type { Minor, MissingRate } from "./types";
import { toMinor } from "./units";
import { convertToBook } from "./valuation";

type Tx = Prisma.TransactionClient;

/** To assign + Σ Left + Assigned(next month): everything the budget holds today. */
export function budgetHolds(view: MonthRead): Minor {
	const state = computeBook(view.loaded.input);
	const c = state.currentMonth;
	return (
		state.toAssign(c).total +
		sumLeft(state, c) +
		state.month(addMonths(c, 1)).totals.assigned
	);
}

export async function bankSide(
	tx: Tx,
	userId: string,
	view: MonthRead,
): Promise<BankSide> {
	const { loaded } = view;
	const H = loaded.book.currency;
	const money = (minor: Minor) => ({ minor, currency: H });
	const accounts = (
		await tx.assetAccount.findMany({
			where: { userId, closedAt: null },
			orderBy: { name: "asc" },
		})
	).filter((a) => inBudget(a, H));
	const foreign = [...new Set(accounts.map((a) => a.currency))].filter(
		(c) => c !== H,
	);
	const rates = foreign.length
		? await RateBook.load(tx, {
				bookCurrency: H,
				rateTypes: [loaded.valuation.defaultRateType, "official"],
				since: addDays(loaded.today, -31),
				extraCurrencies: foreign,
			})
		: null;
	const ctx = rates
		? { ...loaded.valuation, usdRate: rates.lookup }
		: loaded.valuation;
	const missing: MissingRate[] = [];
	const lines = accounts.map((a) => {
		const worth = worthOf(a.type, a.balance);
		const v = convertToBook(
			worth.toString(),
			a.currency,
			{
				date: loaded.today,
				month: loaded.input.currentMonth,
				foreignRateType: a.exchangeRateType ?? "official",
			},
			ctx,
		);
		if (!v.ok) missing.push(v.missing);
		return {
			id: a.id,
			name: a.name,
			worth: {
				minor: toMinor(worth.toString(), a.currency),
				currency: a.currency,
			},
			value: v.ok ? money(v.minor) : null,
		};
	});
	const bank = lines.reduce((t, l) => t + (l.value?.minor ?? 0), 0);
	const holds = budgetHolds(view);
	const missingRates = [...view.dto.missingRates, ...missing];
	return {
		holds: money(holds),
		accounts: lines,
		bank: money(bank),
		difference: money(bank - holds),
		held: view.dto.owed.held,
		reconciledAt: loaded.row.reconciledAt,
		incomplete: missingRates.length > 0 || view.dto.incomplete,
		missingRates: missingRates.map(({ currency, rateType, date }) => ({
			currency,
			rateType,
			date,
		})),
	};
}
