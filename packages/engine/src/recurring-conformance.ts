/**
 * The recurring conformance cases, run against any adapter: the device's
 * (recurring-conformance.test.ts, over LocalDb) and the server's
 * (recurring-conformance.pg.test.ts, over the confirm and skip mutations, the
 * sweep and the template service on a real Postgres). An adapter seeds a user
 * (home currency, saved zone, rates, one template "t1"), runs one step, and
 * reads back what it stored. Every case is a vector whose expected values are
 * derived by hand, in recurring-vectors.ts for confirm, skip and the poster and
 * below for template create and edit, never read back from an implementation.
 *
 * A poster step is one run: on the device the domain's plan and one confirm per
 * entry, on the server one pass of the auto-post sweep. The sweep reports
 * counts, not a stop reason, so its adapter names `stopped` only for what the
 * counts say (the cap, a missing rate); the cases check what an adapter names.
 *
 * Like the other suites it is a list of cases, not tied to a test runner:
 * register each with `it(c.name, () => c.run(makeAdapter))`.
 */
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import type { PosterStop } from "@retrospend/domain/recurring-post/poster";
import {
	RecurringInputRefusal,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import type { TemplateEdit } from "@retrospend/domain/recurring-post/template";
import { expectEqual } from "./conformance";
import type { BookedExpense } from "./expense-create-conformance";
import {
	type ExpectedPost,
	type RecurringSeed,
	type RecurringStep,
	type RecurringVector,
	recurringVectors,
} from "./recurring-vectors";
import type { CreateTemplateInput } from "./template-local";
import { type ComparedTemplate, sameColumnValue } from "./write-parity";

/** A stored expense a recurring write booked: the booked fields and the link to its template. */
export interface PostedRow extends BookedExpense {
	readonly id: string;
	readonly recurringTemplateId: string | null;
}

export interface StepResult {
	/** The expenses the step booked, in the order they were booked. */
	readonly posted: readonly PostedRow[];
	/** Why a poster run stopped, when the adapter can say. */
	readonly stopped?: PosterStop;
	readonly refusal?: string;
}

export type TemplateOp =
	| { readonly create: CreateTemplateInput }
	| { readonly edit: TemplateEdit & { readonly id: string } };

export interface RecurringAdapter {
	/** Starts over: one user with this seed and its template "t1", under the process zone `tz`. */
	reset(seed: RecurringSeed, tz: string): Promise<void>;
	/**
	 * Runs one step. A refusal rejects with the domain's error (RecurringRefusal,
	 * RecurringInputRefusal, MissingRateError) and stores nothing.
	 */
	step(step: RecurringStep, n: number): Promise<StepResult>;
	/** Creates or edits a template by the ids the vector names. */
	template(op: TemplateOp): Promise<void>;
	/** The template as stored. */
	read(id: string): Promise<ComparedTemplate>;
	/** Every stored expense of the user, oldest first. */
	expenses(): Promise<PostedRow[]>;
}

export interface RecurringCase {
	name: string;
	run(make: () => RecurringAdapter | Promise<RecurringAdapter>): Promise<void>;
}

/** The text an expected template is written in: dates as ISO instants. */
export interface ExpectedTemplate {
	nextDueDate: string;
	anchorDay: number | null;
	isActive: boolean;
	autoPay: boolean;
	amount: string;
	currency: string;
	frequency: "WEEKLY" | "MONTHLY";
	categoryId: string | null;
	amountMode: "FIXED" | "ASK";
}

export interface TemplateVector {
	name: string;
	seed: RecurringSeed;
	tz: string;
	ops: TemplateOp[];
	/** The stored template after the ops, by id. */
	expect: Record<string, ExpectedTemplate>;
}

export function expectPost(row: PostedRow, want: ExpectedPost) {
	expectEqual(
		[row.date.toISOString(), row.rateType],
		[want.date, want.rateType],
		"date and rate type",
	);
	for (const column of [
		"amount",
		"amountInUSD",
		"homeRate",
		"homeAmount",
	] as const)
		if (!sameColumnValue(column, row[column], want[column]))
			throw new Error(
				`${column}: expected ${want[column]}, got ${row[column]}`,
			);
	expectEqual(
		[row.status, row.direction, row.excludeFromAnalytics, row.pricingSource],
		["FINALIZED", "OUT", false, "RECURRING"],
		"the posted row's standard fields",
	);
}

const idsOf = async (a: RecurringAdapter) =>
	(await a.expenses()).map((e) => e.id);

async function runVector(
	make: Parameters<RecurringCase["run"]>[0],
	v: RecurringVector,
) {
	const a = await make();
	await a.reset(v.seed, v.tz);
	let n = 0;
	for (const step of v.steps) {
		n += 1;
		const want = step.expect;
		const [rows, due] = [await idsOf(a), (await a.read("t1")).nextDueDate];
		if ("refused" in want || "missingRate" in want) {
			const error = await a.step(step, n).catch((e: unknown) => e);
			if ("missingRate" in want) {
				if (!(error instanceof MissingRateError))
					throw new Error(`expected MissingRateError, got ${String(error)}`);
				expectEqual(error.currencies, want.missingRate, "currencies");
			} else if (
				!(
					(error instanceof RecurringRefusal ||
						error instanceof RecurringInputRefusal) &&
					error.kind === want.refused
				)
			)
				throw new Error(`expected ${want.refused}, got ${String(error)}`);
			// A refusal writes nothing.
			expectEqual(await idsOf(a), rows, "nothing stored");
			expectEqual((await a.read("t1")).nextDueDate, due, "template unchanged");
			continue;
		}
		const done = await a.step(step, n);
		if ("count" in want) {
			expectEqual(done.posted.length, want.count, "posted");
			const total = done.posted.reduce(
				(t, e) => t.plus(dec(e.homeAmount)),
				dec(0),
			);
			if (!total.eq(dec(want.homeTotal)))
				throw new Error(`total: expected ${want.homeTotal}, got ${total}`);
		} else {
			expectEqual(done.posted.length, want.posted.length, "posted");
			want.posted.forEach((p, i) => {
				expectPost(done.posted[i] as PostedRow, p);
			});
			if (want.refusal && done.refusal)
				expectEqual(done.refusal, want.refusal, "refusal");
		}
		if (want.stopped && done.stopped)
			expectEqual(done.stopped, want.stopped, "stopped");
		expectEqual(
			(await a.read("t1")).nextDueDate.toISOString(),
			want.nextDueDate,
			"next due date",
		);
		for (const row of done.posted)
			expectEqual(row.recurringTemplateId, "t1", "template link");
	}
}

/**
 * The stored template as the vectors write it. The columns are listed here by
 * hand, not read from the compare's own list, so a column dropped from that
 * list still fails a case.
 */
const shown = (t: ComparedTemplate): ExpectedTemplate => ({
	nextDueDate: t.nextDueDate.toISOString(),
	anchorDay: t.anchorDay,
	isActive: t.isActive,
	autoPay: t.autoPay,
	amount: dec(t.amount).toFixed(),
	currency: t.currency,
	frequency: t.frequency,
	categoryId: t.categoryId ?? null,
	amountMode: t.amountMode,
});

async function runTemplateVector(
	make: Parameters<RecurringCase["run"]>[0],
	v: TemplateVector,
) {
	const a = await make();
	await a.reset(v.seed, v.tz);
	for (const op of v.ops) await a.template(op);
	for (const [id, want] of Object.entries(v.expect))
		expectEqual(shown(await a.read(id)), want, `template ${id}`);
}

const base = recurringVectors[0] as RecurringVector;
const BASE_TEMPLATE: ExpectedTemplate = {
	nextDueDate: "2026-12-01T03:00:00.000Z",
	anchorDay: 1,
	isActive: true,
	autoPay: true,
	amount: "20",
	currency: "USD",
	frequency: "MONTHLY",
	categoryId: null,
	amountMode: "FIXED",
};
const rent = {
	name: "Gym",
	amount: "35.50",
	currency: "USD",
	frequency: "MONTHLY",
	nextDueDate: "2026-12-15",
} as const;

/**
 * The typed day is the start of that day in the SAVED zone: Dec 15 00:00 at
 * UTC-3 is 03:00Z, and 00:00 at UTC+9 on Jan 7 is Jan 6 15:00Z. An edit's due
 * day is the new anchor; a frequency alone moves neither date nor anchor.
 */
export const templateVectors: TemplateVector[] = [
	{
		name: "create: the typed day starts at 03:00Z in Buenos Aires, its day is the anchor, defaults fixed and automatic",
		seed: base.seed,
		tz: "Pacific/Auckland",
		ops: [{ create: { ...rent, id: "t2" } }],
		expect: {
			t1: BASE_TEMPLATE,
			t2: {
				...BASE_TEMPLATE,
				nextDueDate: "2026-12-15T03:00:00.000Z",
				anchorDay: 15,
				amount: "35.5",
			},
		},
	},
	{
		name: "create in Tokyo: a weekly Jan 7 is Jan 6 15:00Z and an amount that varies never pays itself",
		seed: { ...base.seed, timeZone: "Asia/Tokyo" },
		tz: "UTC",
		ops: [
			{
				create: {
					...rent,
					id: "t2",
					frequency: "WEEKLY",
					nextDueDate: "2026-01-07",
					amountMode: "ASK",
					autoPay: false,
				},
			},
		],
		expect: {
			t1: BASE_TEMPLATE,
			t2: {
				...BASE_TEMPLATE,
				nextDueDate: "2026-01-06T15:00:00.000Z",
				anchorDay: 7,
				frequency: "WEEKLY",
				amount: "35.5",
				amountMode: "ASK",
				autoPay: false,
			},
		},
	},
	{
		name: "edit: pausing changes isActive only",
		seed: base.seed,
		tz: "Pacific/Auckland",
		ops: [{ edit: { id: "t1", isActive: false } }],
		expect: { t1: { ...BASE_TEMPLATE, isActive: false } },
	},
	{
		name: "edit: a due day is the new anchor, a clamped month end included",
		seed: base.seed,
		tz: "UTC",
		ops: [{ edit: { id: "t1", nextDueDate: "2027-02-28" } }],
		expect: {
			t1: {
				...BASE_TEMPLATE,
				nextDueDate: "2027-02-28T03:00:00.000Z",
				anchorDay: 28,
			},
		},
	},
	{
		name: "edit: a frequency alone moves neither the due date nor the anchor",
		seed: base.seed,
		tz: "Pacific/Auckland",
		ops: [{ edit: { id: "t1", frequency: "WEEKLY" } }],
		expect: { t1: { ...BASE_TEMPLATE, frequency: "WEEKLY" } },
	},
	{
		name: "edit: the amount, its mode and auto pay change together, the amount by value",
		seed: base.seed,
		tz: "Pacific/Auckland",
		ops: [
			{
				edit: { id: "t1", amount: "25.00", amountMode: "ASK", autoPay: false },
			},
		],
		expect: {
			t1: { ...BASE_TEMPLATE, amount: "25", amountMode: "ASK", autoPay: false },
		},
	},
	{
		name: "edit in Tokyo: the due day typed under a changed saved zone is that day there",
		seed: { ...base.seed, timeZone: "Asia/Tokyo" },
		tz: "Pacific/Auckland",
		ops: [{ edit: { id: "t1", nextDueDate: "2026-12-01" } }],
		expect: {
			t1: { ...BASE_TEMPLATE, nextDueDate: "2026-11-30T15:00:00.000Z" },
		},
	},
];

export const recurringCases: RecurringCase[] = [
	...recurringVectors.map((v) => ({
		name: v.name,
		run: (make: Parameters<RecurringCase["run"]>[0]) => runVector(make, v),
	})),
	...templateVectors.map((v) => ({
		name: v.name,
		run: (make: Parameters<RecurringCase["run"]>[0]) =>
			runTemplateVector(make, v),
	})),
];
