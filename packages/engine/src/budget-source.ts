/**
 * The budget loader's source over a device store (E2EE P13b): the same
 * `BookSource` the server implements over Postgres (server/services/envelope/
 * inputs.ts), so the one loader in @retrospend/domain/envelope runs on both.
 *
 * What it reads, and from where:
 * - the book, its closes (no checkpoints: every pass runs from the book's
 *   start), the Wealth moves, movements, templates and liabilities a bill
 *   reads, dedicated accounts and rates, from the device's own tables;
 * - own rows through the domain's JS twin of the server's row filters
 *   (budget-rows.ts), never a copy of them;
 * - frozen values and the splits from the ACTIVE budget snapshot, which only
 *   the server can make: other people's shares and the replay, and the values
 *   a foreign row was first valued at (a rate row is rewritten in place, so
 *   they cannot be rebuilt).
 *
 * The device writes nothing back. The loader's fresh values and stale mark are
 * dropped: a row the device values that the server has not frozen yet is newer
 * than the snapshot, and the next pull settles it.
 *
 * Rows the server's checkpoint carried as missing a rate stay out of the
 * device's own valuation by id: the server's pass starts after that checkpoint
 * and counts them missing however the rates stand now, and a device that ran
 * from the book's start would otherwise value them.
 */
import type {
	BookRowCore,
	BookSource,
	CloseRowCore,
	DedicatedAccount,
} from "@retrospend/domain/envelope/book-source";
import {
	isBudgetMoneyIn,
	isBudgetRefund,
	isBudgetSpending,
	isClosedIncome,
} from "@retrospend/domain/envelope/budget-rows";
import type {
	ExpenseRow as BudgetExpense,
	WealthRow,
} from "@retrospend/domain/envelope/entries";
import type {
	BudgetInputsPort,
	OwnRows,
} from "@retrospend/domain/envelope/inputs-port";
import { groupMovements } from "@retrospend/domain/envelope/inputs-port";
import {
	type RateBookParams,
	type RateRow,
	selectRateRows,
} from "@retrospend/domain/envelope/rate-book";
import type {
	LiabilityTerms,
	TemplateTerms,
} from "@retrospend/domain/envelope/target-input";
import type { IsoDate } from "@retrospend/domain/envelope/types";
import { toMinor } from "@retrospend/domain/envelope/units";
import type { FigurePass } from "@retrospend/domain/figures/registry";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	BudgetUnreadable,
	bookRowOf,
	budgetExpenseOf,
	closeRowsOf,
	filterFieldsOf,
} from "./budget-book";
import { once, rowsIn } from "./pass-reads";
import type { Reader } from "./port";

/** A small stable string hash for the loader's fingerprints. A device keeps no checkpoint to compare them with, so it only has to be a function of the text. */
function hashText(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The stored rates as the rate book reads them: the day of each, and the instant to break ties between rows of one day (the later wins). */
function rateRowsOf(
	db: Reader,
	pass: FigurePass | undefined,
): Promise<RateRow[]> {
	return once(pass, "budget.rateRows", async () =>
		rowsIn(db, pass, "rates").map((r) => ({
			currency: r.currency,
			type: r.type,
			rate: dec(r.rate).toFixed(),
			date: r.date.toISOString().slice(0, 10),
			at: r.date.toISOString(),
		})),
	);
}

/** Rate rows the book needs: the twin of the server's SQL (rate-book.ts), picked from the device's table. */
export async function selectedRates(
	db: Reader,
	pass: FigurePass | undefined,
	p: RateBookParams,
): Promise<RateRow[]> {
	return selectRateRows(await rateRowsOf(db, pass), p);
}

/** The rows with ids the checkpoint left out: the block lists them with their rates missing. */
function behindCheckpointOf(
	db: Reader,
	pass: FigurePass | undefined,
): ReadonlySet<string> {
	const active = rowsIn(db, pass, "budgetSnapshot")[0];
	return new Set(
		(active?.splits.checkpointMissingRates ?? []).flatMap((r) =>
			r.rowId ? [r.rowId] : [],
		),
	);
}

function inputsOf(
	db: Reader,
	pass: FigurePass | undefined,
	bookId: string,
): BudgetInputsPort {
	return {
		async ownRows({ from, afterMonth }): Promise<OwnRows> {
			const all = rowsIn(db, pass, "expenses");
			const parents = new Map(all.map((e) => [e.id, e]));
			const parentOf = (id: string) => {
				const p = parents.get(id);
				return p && { amortizeMode: p.amortizeMode ?? "INSTALLMENTS" };
			};
			const behind = behindCheckpointOf(db, pass);
			const own: OwnRows = {
				moneyIn: [],
				spending: [],
				refunds: [],
				movements: [],
			};
			for (const e of all) {
				if (behind.has(e.id)) continue;
				const fields = filterFieldsOf(e);
				if (isBudgetMoneyIn(fields, from)) own.moneyIn.push(budgetExpenseOf(e));
				if (isBudgetSpending(fields, parentOf, from))
					own.spending.push(budgetExpenseOf(e));
				if (isBudgetRefund(fields, from)) own.refunds.push(budgetExpenseOf(e));
			}
			own.movements = groupMovements(
				rowsIn(db, pass, "budgetMovements").filter((m) => m.bookId === bookId),
				afterMonth,
			);
			return own;
		},

		async wealthRows(): Promise<WealthRow[]> {
			return rowsIn(db, pass, "wealthTransfers")
				.filter((w) => w.bookId === bookId)
				.map((w) => {
					if (w.direction !== "TO_WEALTH" && w.direction !== "FROM_WEALTH")
						throw new BudgetUnreadable("A Wealth move direction is unknown");
					return {
						id: w.id,
						direction: w.direction,
						envelopeId: w.envelopeId,
						date: w.date,
						amount: dec(w.amount),
					};
				});
		},

		rateRows: (p) => selectedRates(db, pass, p),
	};
}

/** The income rows of closed months, by the twin of the server's closed-income filter. */
export function closedIncomeRows(
	db: Reader,
	pass: FigurePass | undefined,
	window: { from: Date; to: Date },
): BudgetExpense[] {
	return rowsIn(db, pass, "expenses")
		.filter((e) => isClosedIncome(filterFieldsOf(e), window.from, window.to))
		.map(budgetExpenseOf);
}

/** The starting balance row as a money-in row: read in full, whatever its status, as the server does. */
export function expenseById(db: Reader, id: string): BudgetExpense | undefined {
	const row = db.get("expenses", id);
	return row && budgetExpenseOf(row);
}

function templatesOf(
	db: Reader,
	pass: FigurePass | undefined,
	row: BookRowCore,
): TemplateTerms[] {
	const ids = new Set(
		row.envelopes.flatMap((e) =>
			e.targetTemplateId ? [e.targetTemplateId] : [],
		),
	);
	if (ids.size === 0) return [];
	return rowsIn(db, pass, "recurringTemplates")
		.filter((t) => ids.has(t.id))
		.map((t) => ({
			id: t.id,
			currency: t.currency,
			amount: dec(t.amount),
			frequency: t.frequency,
			nextDueDate: t.nextDueDate,
		}));
}

/** Payments to the liabilities since the first of last month: principal plus the fee expense, in the liability's units, as the server reads them. */
function liabilityTermsOf(
	db: Reader,
	pass: FigurePass | undefined,
	row: BookRowCore,
	today: IsoDate,
): LiabilityTerms[] {
	const ids = new Set(
		row.envelopes.flatMap((e) =>
			e.targetLiabilityId ? [e.targetLiabilityId] : [],
		),
	);
	if (ids.size === 0) return [];
	const accounts = rowsIn(db, pass, "accounts").filter((a) => ids.has(a.id));
	if (accounts.length === 0) return [];
	const since = firstOfLastMonth(today);
	const paid = rowsIn(db, pass, "transfers").filter(
		(t) =>
			t.toAccountId !== null &&
			ids.has(t.toAccountId) &&
			t.date.getTime() >= since,
	);
	return accounts.map((a) => ({
		id: a.id,
		currency: a.currency,
		minimumPayment: a.minimumPayment == null ? null : dec(a.minimumPayment),
		dueDate: a.dueDate ?? null,
		payments: paid
			.filter((p) => p.toAccountId === a.id)
			.map((p) => {
				const fee =
					p.feeExpenseId === null
						? undefined
						: db.get("expenses", p.feeExpenseId);
				return {
					date: p.date.toISOString().slice(0, 10),
					minor:
						toMinor(p.toAmount, a.currency) +
						(fee ? toMinor(dec(fee.amount).toString(), a.currency) : 0),
				};
			}),
	}));
}

/** The first of last month at UTC midnight, from today's date in the book zone. */
function firstOfLastMonth(today: IsoDate): number {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7));
	return Date.UTC(year, month - 2, 1);
}

function dedicatedOf(
	db: Reader,
	pass: FigurePass | undefined,
	row: BookRowCore,
): DedicatedAccount[] {
	const ids = new Set(
		row.envelopes.flatMap((e) =>
			e.wealthDedicated && e.wealthAccountId && e.kind === "SAVINGS"
				? [e.wealthAccountId]
				: [],
		),
	);
	if (ids.size === 0) return [];
	return rowsIn(db, pass, "accounts")
		.filter((a) => ids.has(a.id) && a.closedAt === null)
		.map((a) => ({
			id: a.id,
			type: a.type,
			balance: dec(a.balance),
			currency: a.currency,
			exchangeRateType: a.exchangeRateType,
		}));
}

/** The loader's source over `db`: a store, a transaction or a snapshot. Reads the ACTIVE budget snapshot only. */
export function storeBookSource(
	db: Reader,
	opts: { userId: string; pass?: FigurePass },
): BookSource<BookRowCore, CloseRowCore> {
	const { userId, pass } = opts;
	// Listed once per pass: the block is large and a read copies it.
	const active = () => rowsIn(db, pass, "budgetSnapshot")[0];
	return {
		book: async () => bookRowOf(db, pass, userId),
		inputs: (row) => inputsOf(db, pass, row.id),
		closes: async (row) => closeRowsOf(db, pass, row.id),
		dirtyMarks: async () => [],
		frozenValues: async () =>
			new Map(
				(active()?.frozen ?? []).map((f) => [
					f.key,
					{ minor: f.minor, approximate: f.approximate },
				]),
			),
		targetSources: async (row, today) => ({
			templates: templatesOf(db, pass, row),
			liabilities: liabilityTermsOf(db, pass, row, today),
		}),
		dedicatedAccounts: async (row) => dedicatedOf(db, pass, row),
		// A device holds no one else's shares: the loader takes the block below.
		splits: async () => {
			throw new BudgetUnreadable("A device loads its splits from the block");
		},
		splitBlock: async () => {
			const snapshot = active();
			if (!snapshot) throw new BudgetUnreadable("No budget block is held");
			return snapshot.splits;
		},
		hash: hashText,
	};
}
