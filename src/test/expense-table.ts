/**
 * In-memory expense table for tests. Wires `db.expense.findMany` and
 * `db.expense.groupBy` to filter and group a fixed list of rows the way
 * Prisma would for simple where clauses (equality, gte/lte/gt/lt, in, not).
 */
import type { Mock } from "vitest";

export interface TestExpenseRow {
	id?: string;
	userId?: string;
	date: Date;
	amount: number;
	currency: string;
	amountInUSD: number;
	categoryId?: string | null;
	status?: string;
	isAmortizedParent?: boolean;
	isAmortizedChild?: boolean;
	excludeFromAnalytics?: boolean;
	title?: string | null;
	direction?: "OUT" | "IN";
	entryKind?: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
	inType?: "INCOME" | "REFUND" | null;
	amortizeMode?: "INSTALLMENTS" | "REPORTS_ONLY";
}

type Row = Required<Omit<TestExpenseRow, "title" | "id" | "inType">> & {
	id: string;
	title: string | null;
	inType: "INCOME" | "REFUND" | null;
};

function normalize(rows: TestExpenseRow[]): Row[] {
	return rows.map((r, i) => ({
		id: r.id ?? `exp-${i + 1}`,
		userId: r.userId ?? "user-1",
		categoryId: r.categoryId ?? null,
		status: r.status ?? "FINALIZED",
		isAmortizedParent: r.isAmortizedParent ?? false,
		isAmortizedChild: r.isAmortizedChild ?? false,
		excludeFromAnalytics: r.excludeFromAnalytics ?? false,
		title: r.title ?? null,
		direction: r.direction ?? "OUT",
		entryKind: r.entryKind ?? "STANDARD",
		inType: r.inType ?? null,
		amortizeMode: r.amortizeMode ?? "INSTALLMENTS",
		date: r.date,
		amount: r.amount,
		currency: r.currency,
		amountInUSD: r.amountInUSD,
	}));
}

function matchesValue(value: unknown, condition: unknown): boolean {
	if (
		condition === null ||
		typeof condition !== "object" ||
		condition instanceof Date
	) {
		if (condition instanceof Date && value instanceof Date)
			return value.getTime() === condition.getTime();
		return value === condition;
	}
	const c = condition as Record<string, unknown>;
	const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
	if ("gte" in c && c.gte !== undefined && !(cmp(value) >= cmp(c.gte)))
		return false;
	if ("lte" in c && c.lte !== undefined && !(cmp(value) <= cmp(c.lte)))
		return false;
	if ("gt" in c && c.gt !== undefined && !(cmp(value) > cmp(c.gt)))
		return false;
	if ("lt" in c && c.lt !== undefined && !(cmp(value) < cmp(c.lt)))
		return false;
	if ("in" in c && Array.isArray(c.in) && !c.in.includes(value)) return false;
	if ("not" in c && matchesValue(value, c.not)) return false;
	return true;
}

function matchesWhere(row: Row, where: Record<string, unknown> = {}): boolean {
	return Object.entries(where).every(([key, condition]) => {
		if (condition === undefined) return true;
		if (key === "AND" && Array.isArray(condition))
			return condition.every((w) => matchesWhere(row, w));
		if (key === "OR" && Array.isArray(condition))
			return condition.some((w) => matchesWhere(row, w));
		return matchesValue(row[key as keyof Row], condition);
	});
}

export function useExpenseTable(
	db: { expense: { findMany: Mock; groupBy: Mock } },
	input: TestExpenseRow[],
) {
	const rows = normalize(input);

	db.expense.findMany.mockImplementation(
		async (args: { where?: Record<string, unknown> } = {}) =>
			rows.filter((r) => matchesWhere(r, args.where)).map((r) => ({ ...r })),
	);

	db.expense.groupBy.mockImplementation(
		async (args: {
			by: (keyof Row)[];
			where?: Record<string, unknown>;
			_sum?: Record<string, boolean>;
		}) => {
			const groups = new Map<string, Row[]>();
			for (const r of rows.filter((row) => matchesWhere(row, args.where))) {
				const key = JSON.stringify(args.by.map((k) => r[k]));
				const list = groups.get(key) ?? [];
				list.push(r);
				groups.set(key, list);
			}
			return [...groups.values()].map((list) => {
				const first = list[0] as Row;
				const out: Record<string, unknown> = {};
				for (const k of args.by) out[k] = first[k];
				out._sum = {
					amount: list.reduce((s, r) => s + r.amount, 0),
					amountInUSD: list.reduce((s, r) => s + r.amountInUSD, 0),
				};
				out._count = { _all: list.length };
				return out;
			});
		},
	);

	return rows;
}
