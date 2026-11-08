/** Expenses with the shares that belong to them, as one aggregate. */
import { tableReads, tableWrites } from "./crud";
import { NotFoundError } from "./errors";
import {
	InvalidInputError,
	type Reader,
	type ShareRow,
	type TableRows,
	type Writer,
} from "./port";

export type ExpenseRow = TableRows["expenses"];

export interface ExpenseAggregate {
	readonly expense: ExpenseRow;
	readonly shares: readonly ShareRow[];
}

export function expenseReads(r: Reader) {
	const expenses = tableReads(r, "expenses");
	const sharesOf = (expenseId: string) =>
		r.list("shares").filter((s) => s.expenseId === expenseId);
	return {
		get(id: string): ExpenseAggregate | undefined {
			const expense = expenses.get(id);
			return expense && { expense, shares: sharesOf(id) };
		},
		list: (): ExpenseAggregate[] =>
			expenses
				.list()
				.map((expense) => ({ expense, shares: sharesOf(expense.id) })),
		sharesOf,
	};
}

export function expenseRepo(w: Writer) {
	const reads = expenseReads(w);
	const expenses = tableWrites(w, "expenses");
	const shares = tableWrites(w, "shares");

	/** Each share names this expense, has its own id, and does not take another expense's row. */
	function checkShares({ expense, shares: rows }: ExpenseAggregate) {
		const seen = new Set<string>();
		for (const s of rows) {
			if (s.expenseId !== expense.id)
				throw new InvalidInputError(
					`Share ${s.id} belongs to ${s.expenseId}, not ${expense.id}`,
				);
			if (seen.has(s.id))
				throw new InvalidInputError(`Share ${s.id} appears twice`);
			seen.add(s.id);
			const stored = w.get("shares", s.id);
			if (stored && stored.expenseId !== expense.id)
				throw new InvalidInputError(`Share ${s.id} belongs to another expense`);
		}
	}

	return {
		...reads,
		/** Adds the expense and its shares; an existing id throws InvalidInputError. */
		create(a: ExpenseAggregate) {
			checkShares(a);
			expenses.insert(a.expense);
			for (const s of a.shares) shares.insert(s);
		},
		/** Makes the expense and its shares exactly `a`: shares not listed are removed. */
		update(a: ExpenseAggregate) {
			checkShares(a);
			expenses.replace(a.expense);
			const keep = new Set(a.shares.map((s) => s.id));
			for (const s of reads.sharesOf(a.expense.id))
				if (!keep.has(s.id)) shares.remove(s.id);
			for (const s of a.shares) w.put("shares", s);
		},
		/** Removes the expense and its shares; true when it existed. */
		remove(id: string): boolean {
			if (!expenses.get(id)) return false;
			for (const s of reads.sharesOf(id)) shares.remove(s.id);
			return expenses.remove(id);
		},
		/** Like `get`, but a missing expense throws NotFoundError. */
		require(id: string): ExpenseAggregate {
			const found = reads.get(id);
			if (!found) throw new NotFoundError(`expenses ${id} does not exist`);
			return found;
		},
	};
}
