/**
 * The conformance cases for expense edit and delete, run against any adapter:
 * the local one (local-expense-edit.ts) and the server's (the pg twin runs the
 * same cases through the domain core's Prisma adapter). An adapter seeds a
 * user, creates the expense a vector starts from, edits or deletes it, and
 * reads it back. Every expected value is derived by hand in
 * expense-edit-vectors.ts, never read from an implementation.
 */
import { getFiscalMonthRange } from "@retrospend/domain/fiscal-month";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import { countsAsSpending } from "@retrospend/domain/spent";
import { expectEqual } from "./conformance";
import type { CreateExpenseInput } from "./expense-create";
import type {
	BookedExpense,
	ExpectedMoney,
	ExpenseSeed,
	MonthCheck,
	RateSeed,
} from "./expense-create-conformance";
import { differingFields } from "./write-parity";

/** The form fields an edit changes; every other field is the base expense's. */
export interface EditFields {
	title?: string;
	amount?: string;
	currency?: string;
	date?: Date;
	rateType?: string;
}

export interface ExpenseEditAdapter {
	/** Starts over: one user with this seed and no expenses. */
	reset(seed: ExpenseSeed): Promise<void>;
	/** Creates the expense a vector starts from, through the create core. */
	create(input: CreateExpenseInput): Promise<void>;
	/** Replaces the rate table: the server rewrites its rates daily. */
	setRates(rates: RateSeed[]): Promise<void>;
	/** Edits the expense, saving the base's fields with `fields` laid over them. */
	edit(
		base: CreateExpenseInput,
		fields: EditFields,
	): Promise<{ expense: BookedExpense; undo(): Promise<void> }>;
	/** Deletes the expense. */
	remove(id: string): Promise<{ undo(): Promise<void> }>;
	/** The stored expense, or null. */
	read(id: string): Promise<BookedExpense | null>;
}

export interface EditVector {
	name: string;
	seed: ExpenseSeed;
	/** The expense before the edit. */
	base: CreateExpenseInput;
	/** The rate table after the create and before the edit. */
	ratesThen?: RateSeed[];
	edit: EditFields;
	/** The booked money after the edit, the currencies a MissingRateError names, or the refusal's message. */
	expect:
		| { booked: ExpectedMoney }
		| { missingRate: string[] }
		| { refused: string };
	/** Months of the seed's zone (start day 1) the expense is checked against, before and after the edit. */
	months?: { before: MonthCheck[]; after: MonthCheck[] };
}

export interface ExpenseEditCase {
	name: string;
	run(
		make: () => ExpenseEditAdapter | Promise<ExpenseEditAdapter>,
	): Promise<void>;
}

const MONEY = [
	"amount",
	"amountInUSD",
	"exchangeRate",
	"homeRate",
	"homeAmount",
] as const;

function expectMonths(
	row: BookedExpense,
	seed: ExpenseSeed,
	months: MonthCheck[],
	when: string,
) {
	for (const m of months) {
		const range = getFiscalMonthRange(
			new Date(Date.UTC(m.year, m.month, 15, 12)),
			1,
			seed.timeZone,
		);
		expectEqual(
			[range.start.toISOString(), range.end.toISOString()],
			[m.start, m.end],
			`range of ${m.year}-${m.month + 1}`,
		);
		if (countsAsSpending(row, range) !== m.counts)
			throw new Error(
				`${when}: ${m.year}-${m.month + 1} counts as spending should be ${m.counts}`,
			);
	}
}

/** Same row, field by field: a refused write or an undo leaves exactly this. */
function expectSame(
	a: BookedExpense | null,
	b: BookedExpense | null,
	what: string,
) {
	if (!a || !b) return expectEqual(a, b, what);
	expectEqual(differingFields(a, b), [], what);
	expectEqual(a.excludeFromAnalytics, b.excludeFromAnalytics, what);
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (e) {
		return e;
	}
	return undefined;
}

async function runVector(
	make: () => ExpenseEditAdapter | Promise<ExpenseEditAdapter>,
	v: EditVector,
) {
	const adapter = await make();
	await adapter.reset(v.seed);
	await adapter.create(v.base);
	const before = await adapter.read(v.base.id);
	if (!before) throw new Error("the base expense was not stored");
	if (v.months) expectMonths(before, v.seed, v.months.before, "before");
	if (v.ratesThen) await adapter.setRates(v.ratesThen);

	if ("missingRate" in v.expect || "refused" in v.expect) {
		const thrown = await thrownBy(() => adapter.edit(v.base, v.edit));
		if ("missingRate" in v.expect) {
			if (!(thrown instanceof MissingRateError))
				throw new Error(`expected MissingRateError, got ${String(thrown)}`);
			expectEqual(thrown.currencies, v.expect.missingRate, "currencies");
		} else {
			if (!(thrown instanceof Error))
				throw new Error(`expected a refusal, got ${String(thrown)}`);
			// Server and device refuse with the same words (the domain's).
			expectEqual(thrown.message, v.expect.refused, "refusal");
		}
		expectSame(await adapter.read(v.base.id), before, "refused: row unchanged");
		return;
	}

	const want = v.expect.booked;
	const { expense: got, undo } = await adapter.edit(v.base, v.edit);
	// What an edit never decides stays as the base had it.
	expectEqual(
		[
			got.status,
			got.direction,
			got.entryKind,
			got.inType,
			got.isAmortizedParent,
		],
		[before.status, before.direction, before.entryKind, before.inType, false],
		"standard fields",
	);
	expectEqual(
		[got.currency, got.rateType, got.homeCurrency, got.pricingSource],
		[
			v.edit.currency ?? v.base.currency,
			want.rateType,
			want.homeCurrency,
			before.pricingSource,
		],
		"currency, type, home, source",
	);
	expectEqual(
		got.date.getTime(),
		(v.edit.date ?? v.base.date).getTime(),
		"date",
	);
	for (const f of MONEY)
		if (!dec(got[f]).eq(dec(want[f])))
			throw new Error(`${f}: expected ${want[f]}, got ${got[f]}`);
	if (v.months) expectMonths(got, v.seed, v.months.after, "after");
	expectSame(await adapter.read(v.base.id), got, "stored is what was returned");
	await undo();
	expectSame(await adapter.read(v.base.id), before, "undone");
}

export function expenseEditCases(vectors: EditVector[]): ExpenseEditCase[] {
	const first = vectors[0] as EditVector;
	return [
		...vectors.map((v) => ({
			name: v.name,
			run: (make: Parameters<ExpenseEditCase["run"]>[0]) => runVector(make, v),
		})),
		{
			name: "delete removes the row and its undo brings it back as it was",
			async run(make) {
				const adapter = await make();
				await adapter.reset(first.seed);
				await adapter.create(first.base);
				const before = await adapter.read(first.base.id);
				const { undo } = await adapter.remove(first.base.id);
				expectEqual(await adapter.read(first.base.id), null, "deleted");
				await undo();
				expectSame(await adapter.read(first.base.id), before, "restored");
			},
		},
		{
			name: "deleting an id that is not there is refused",
			async run(make) {
				const adapter = await make();
				await adapter.reset(first.seed);
				const thrown = await thrownBy(() => adapter.remove("nope"));
				if (!(thrown instanceof Error))
					throw new Error("a delete of nothing was not refused");
				expectEqual(thrown.message, "Expense not found", "refusal");
			},
		},
	];
}
