/**
 * The conformance cases for expense create, run against any adapter: the
 * local one today (local-expense-create.ts), the server's Prisma one when
 * createExpenseIn moves behind the ports. An adapter seeds a user (home
 * currency, zone, rate table), creates one expense and can undo it; every
 * case is a vector whose expected values are derived by hand in
 * expense-create-vectors.ts, never read back from an implementation.
 *
 * Like the other suites it is a list of cases, not tied to a test runner:
 * register each with `it(c.name, () => c.run(makeAdapter))`.
 */
import { getFiscalMonthRange } from "@retrospend/domain/fiscal-month";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import { countsAsSpending } from "@retrospend/domain/spent";
import { expectEqual } from "./conformance";
import type { CreateExpenseInput } from "./expense-create";
import { vectors } from "./expense-create-vectors";

export interface RateSeed {
	currency: string;
	type: string;
	/** Units per USD, as decimal text. */
	rate: string;
	date: Date;
}

/** The user and rate table a case starts from. */
export interface ExpenseSeed {
	homeCurrency: string;
	timeZone: string;
	/** The preferred rate type per home currency; absent: the built-in default. */
	defaultRateTypes?: Record<string, string>;
	rates: RateSeed[];
}

/** An expense as stored: the fields a create decides. Decimals are text. */
export interface BookedExpense {
	status: string;
	direction: string;
	entryKind: string;
	inType: string | null;
	isAmortizedParent: boolean;
	excludeFromAnalytics: boolean;
	categoryKind: string | null;
	categoryId: string | null;
	date: Date;
	currency: string;
	amount: string;
	amountInUSD: string;
	exchangeRate: string;
	rateType: string | null;
	homeCurrency: string;
	homeRate: string;
	homeAmount: string;
	pricingSource: string;
}

export interface ExpenseCreateAdapter {
	/** Starts over: one user with this seed and no expenses. */
	reset(seed: ExpenseSeed): Promise<void>;
	/** Creates an expense; rejects with MissingRateError when a rate is missing. */
	create(
		input: CreateExpenseInput,
	): Promise<{ expense: BookedExpense; undo(): Promise<void> }>;
	/** The ids of every stored expense. */
	expenseIds(): Promise<string[]>;
}

/** The money fields a vector derives by hand; the rest of the row is the standard create. */
export type ExpectedMoney = Pick<
	BookedExpense,
	| "amount"
	| "amountInUSD"
	| "exchangeRate"
	| "rateType"
	| "homeCurrency"
	| "homeRate"
	| "homeAmount"
>;

/** A fiscal month, with its range worked out by hand and whether the expense counts in it. */
export interface MonthCheck {
	year: number;
	/** 0-based. */
	month: number;
	start: string;
	end: string;
	counts: boolean;
}

export interface CreateVector {
	name: string;
	seed: ExpenseSeed;
	input: CreateExpenseInput;
	/** The booked money, or the currencies a MissingRateError names. */
	expect: { booked: ExpectedMoney } | { missingRate: string[] };
	/** Months of the seed's zone (start day 1) the created expense is checked against. */
	months?: MonthCheck[];
}

export interface ExpenseCreateCase {
	name: string;
	run(make: () => ExpenseCreateAdapter | Promise<ExpenseCreateAdapter>): Promise<void>;
}

const sameDecimal = (a: string, b: string) => dec(a).eq(dec(b));

function expectDecimal(actual: string, expected: string, what: string) {
	if (!sameDecimal(actual, expected))
		throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

async function runVector(
	make: () => ExpenseCreateAdapter | Promise<ExpenseCreateAdapter>,
	v: CreateVector,
) {
	const adapter = await make();
	await adapter.reset(v.seed);
	if ("missingRate" in v.expect) {
		let thrown: unknown;
		try {
			await adapter.create(v.input);
		} catch (e) {
			thrown = e;
		}
		if (!(thrown instanceof MissingRateError))
			throw new Error(`expected MissingRateError, got ${String(thrown)}`);
		expectEqual(thrown.currencies, v.expect.missingRate, "currencies");
		expectEqual(await adapter.expenseIds(), [], "nothing stored");
		return;
	}
	const want = v.expect.booked;
	const { expense: got, undo } = await adapter.create(v.input);
	expectEqual(
		[
			got.status,
			got.direction,
			got.entryKind,
			got.inType,
			got.isAmortizedParent,
			got.excludeFromAnalytics,
			got.categoryKind,
			got.categoryId,
			got.currency,
			got.pricingSource,
			got.homeCurrency,
			got.rateType,
		],
		[
			"FINALIZED",
			"OUT",
			"STANDARD",
			null,
			false,
			false,
			null,
			null,
			v.input.currency,
			v.input.pricingSource ?? "MANUAL",
			want.homeCurrency,
			want.rateType,
		],
		"standard fields",
	);
	expectEqual(got.date.getTime(), v.input.date.getTime(), "date");
	for (const f of [
		"amount",
		"amountInUSD",
		"exchangeRate",
		"homeRate",
		"homeAmount",
	] as const)
		expectDecimal(got[f], want[f], f);
	for (const m of v.months ?? []) {
		const range = getFiscalMonthRange(
			new Date(Date.UTC(m.year, m.month, 15, 12)),
			1,
			v.seed.timeZone,
		);
		expectEqual(
			[range.start.toISOString(), range.end.toISOString()],
			[m.start, m.end],
			`range of ${m.year}-${m.month + 1}`,
		);
		if (countsAsSpending(got, range) !== m.counts)
			throw new Error(
				`${m.year}-${m.month + 1}: counts as spending should be ${m.counts}`,
			);
	}
	expectEqual(await adapter.expenseIds(), [v.input.id], "stored");
	await undo();
	expectEqual(await adapter.expenseIds(), [], "undone");
}

const first = vectors[0] as CreateVector;

export const expenseCreateCases: ExpenseCreateCase[] = [
	...vectors.map((v) => ({
		name: v.name,
		run: (make: Parameters<ExpenseCreateCase["run"]>[0]) => runVector(make, v),
	})),
	{
		name: "an id already in use is refused and the first expense is untouched",
		async run(make) {
			const adapter = await make();
			await adapter.reset(first.seed);
			await adapter.create(first.input);
			let refused = false;
			try {
				await adapter.create({ ...first.input, title: "again" });
			} catch {
				refused = true;
			}
			if (!refused) throw new Error("a second create with the id succeeded");
			expectEqual(await adapter.expenseIds(), [first.input.id], "stored");
		},
	},
	{
		name: "undo frees the id: the same expense can be created again",
		async run(make) {
			const adapter = await make();
			await adapter.reset(first.seed);
			const { undo } = await adapter.create(first.input);
			await undo();
			await adapter.create(first.input);
			expectEqual(await adapter.expenseIds(), [first.input.id], "stored");
		},
	},
];
