/**
 * Recurring confirm, skip and catch-up on the device store, against the
 * hand-derived vectors (recurring-vectors.ts), and the preview, undo and
 * refusal behavior around them. Home is ARS at blue 1545 in Buenos Aires
 * unless a case says otherwise; the vectors carry their own arithmetic.
 */

import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	RecurringInputRefusal,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError } from "./errors";
import { LocalDb } from "./local-db";
import { seededStore } from "./local-expense-create";
import { dump } from "./local-fixtures";
import { InvalidInputError, type Store } from "./port";
import {
	createDevicePreviewRunner,
	RECURRING_CATCH_UP_MUTATION,
	RECURRING_CONFIRM_MUTATION,
	RECURRING_SKIP_MUTATION,
} from "./preview";
import {
	catchUpRecurring,
	confirmRecurring,
	INCOME_NOT_ON_DEVICE,
	RECURRING_CATCH_UP,
	RECURRING_CONFIRM,
	RECURRING_SKIP,
	skipRecurring,
} from "./recurring-local";
import {
	type ExpectedPost,
	type RecurringSeed,
	type RecurringStep,
	type RecurringVector,
	recurringVectors,
} from "./recurring-vectors";
import { deviceFigures, GLANCE_SPENT } from "./registry";
import type { TemplateRow } from "./templates";
import { sameColumnValue } from "./write-parity";

// The engine's tsconfig has no node types; a test sets the process zone.
declare const process: { env: Record<string, string | undefined> };

const originalTZ = process.env.TZ;
afterEach(() => {
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

/** The hour of UTC midnight in each process zone a vector names: proof the zone took effect. */
const MIDNIGHT_HOUR: Record<string, number> = {
	UTC: 0,
	"Asia/Tokyo": 9,
	"Pacific/Auckland": 13,
};

function runUnder(tz: string) {
	process.env.TZ = tz;
	expect(new Date("2026-12-01T00:00:00Z").getHours()).toBe(MIDNIGHT_HOUR[tz]);
}

const templateOf = (seed: RecurringSeed): TemplateRow => ({
	id: "t1",
	name: "Rent",
	amount: seed.template.amount,
	currency: seed.template.currency,
	frequency: seed.template.frequency,
	nextDueDate: seed.template.nextDueDate,
	anchorDay: seed.template.anchorDay,
	direction: "OUT",
	isActive: seed.template.isActive ?? true,
	autoPay: seed.template.autoPay ?? true,
	amountMode: seed.template.amountMode ?? "FIXED",
	categoryId: null,
	category: null,
	websiteUrl: null,
	paymentSource: null,
	version: "v1",
});

async function open(seed: RecurringSeed, over: Partial<TemplateRow> = {}) {
	const store = await seededStore(seed);
	await store.transaction((tx) =>
		tx.put("recurringTemplates", { ...templateOf(seed), ...over }),
	);
	return { store, db: new LocalDb(store) };
}

const template = (store: Store) => {
	const row = store.list("recurringTemplates").find((t) => t.id === "t1");
	if (!row) throw new Error("no template");
	return row;
};

const notProtected = async () => false;

/** The posts of a step, in the order they were made. */
async function perform(db: LocalDb, step: RecurringStep, n: number) {
	const base = { templateId: "t1", now: step.now };
	if (step.call === "skip") {
		await db.write(RECURRING_SKIP, skipRecurring(base));
		return { posted: [], stopped: undefined, refusal: undefined };
	}
	if (step.call === "confirm") {
		const { value } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({
				...base,
				clientId: `e${n}`,
				zone: step.zone,
				paidOn: step.paidOn,
				confirmedAmount: step.confirmedAmount,
				dueAt: step.dueAt,
			}),
		);
		return { posted: [value.expense], stopped: undefined, refusal: undefined };
	}
	const { value } = await db.write(
		RECURRING_CATCH_UP,
		catchUpRecurring({
			...base,
			clientId: (i) => `p${n}-${i}`,
			isProtected: notProtected,
		}),
	);
	return value;
}

function expectPost(
	row: {
		date: Date;
		amount: unknown;
		amountInUSD: unknown;
		homeRate?: unknown;
		homeAmount: unknown;
		rateType?: unknown;
	},
	want: ExpectedPost,
) {
	expect(row.date.toISOString()).toBe(want.date);
	expect(row.rateType).toBe(want.rateType);
	for (const column of [
		"amount",
		"amountInUSD",
		"homeRate",
		"homeAmount",
	] as const)
		expect(
			sameColumnValue(column, row[column], want[column]),
			`${column} ${String(row[column])} is not ${want[column]}`,
		).toBe(true);
}

async function runVector(v: RecurringVector) {
	const { store, db } = await open(v.seed);
	runUnder(v.tz);
	let n = 0;
	for (const step of v.steps) {
		n += 1;
		const before = dump(store);
		const want = step.expect;
		if ("refused" in want || "missingRate" in want) {
			const error = await perform(db, step, n).catch((e) => e);
			if ("missingRate" in want) {
				expect(error).toBeInstanceOf(MissingRateError);
				expect((error as MissingRateError).currencies).toEqual(
					want.missingRate,
				);
			} else {
				expect(error).toSatisfy(
					(e: unknown) =>
						(e instanceof RecurringRefusal ||
							e instanceof RecurringInputRefusal) &&
						e.kind === want.refused,
				);
			}
			// A refusal writes nothing.
			expect(dump(store)).toEqual(before);
			continue;
		}
		const done = await perform(db, step, n);
		if ("count" in want) {
			expect(done.posted).toHaveLength(want.count);
			let total = dec(0);
			for (const e of done.posted)
				total = total.plus(dec(String(e.homeAmount)));
			expect(total.eq(dec(want.homeTotal))).toBe(true);
			expect(done.stopped).toBe(want.stopped);
		} else {
			expect(done.posted).toHaveLength(want.posted.length);
			want.posted.forEach((p, i) => {
				expectPost(done.posted[i] as (typeof done.posted)[number], p);
			});
			if (want.stopped) expect(done.stopped).toBe(want.stopped);
			if (want.refusal) expect(done.refusal).toBe(want.refusal);
		}
		expect(template(store).nextDueDate.toISOString()).toBe(want.nextDueDate);
	}
}

describe("recurring confirm, skip and catch-up vectors", () => {
	for (const v of recurringVectors) it(v.name, () => runVector(v));
});

const base = recurringVectors[0] as RecurringVector;
const DEC_1 = new Date("2026-12-01T03:00:00Z");

describe("the posted row and the template", () => {
	it("is today's server row: titled from the template, linked, finalized, never excluded", async () => {
		const { store, db } = await open(base.seed);
		const { value } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DEC_1, clientId: "e1" }),
		);
		expect(value.expense).toMatchObject({
			id: "e1",
			title: "Rent",
			status: "FINALIZED",
			direction: "OUT",
			entryKind: "STANDARD",
			inType: null,
			pricingSource: "RECURRING",
			recurringTemplateId: "t1",
			excludeFromAnalytics: false,
			currency: "USD",
			homeCurrency: "ARS",
			version: null,
		});
		expect(store.list("expenses")).toEqual([value.expense]);
		// The device advanced it; the server's answer names the next version.
		expect(template(store)).toMatchObject({ version: null, anchorDay: 1 });
	});

	// A category that excludes by default does not change a recurring post:
	// the row books ARS 30,900.00 and glance.spent moves by 3,090,000 minor.
	it("books into spending even in an excludeByDefault category", async () => {
		const { store, db } = await open(base.seed, { categoryId: "c1" });
		await store.transaction((tx) =>
			tx.put("categories", {
				id: "c1",
				kind: "EXPENSE",
				name: "Housing",
				color: "blue",
				icon: null,
				excludeByDefault: true,
			}),
		);
		const figures = deviceFigures({ clock: () => DEC_1 });
		const read = async () =>
			(
				await readFiguresIn(
					store,
					[figures.get(GLANCE_SPENT)],
					{ userId: "u1" },
					new FigurePass(),
				)
			).get(GLANCE_SPENT);
		const before = await read();
		const { value } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DEC_1, clientId: "e1" }),
		);
		expect(value.expense.excludeFromAnalytics).toBe(false);
		expect(value.expense.categoryKind).toBe("EXPENSE");
		expect(JSON.stringify(await read())).not.toBe(JSON.stringify(before));
		expect(JSON.stringify(await read())).toContain("3090000");
	});

	it("checks the template version the caller saw", async () => {
		const { store, db } = await open(base.seed);
		const before = dump(store);
		const stale = confirmRecurring({
			templateId: "t1",
			now: DEC_1,
			clientId: "e1",
			expectedVersion: "v0",
		});
		await expect(db.write(RECURRING_CONFIRM, stale)).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "changed",
		);
		expect(dump(store)).toEqual(before);
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: "t1",
					now: DEC_1,
					clientId: "e1",
					expectedVersion: "v1",
				}),
			),
		).resolves.toBeDefined();
		// A template the device advanced has no version to name.
		await expect(
			db.write(
				RECURRING_SKIP,
				skipRecurring({
					templateId: "t1",
					now: new Date("2027-01-01T03:00:00Z"),
					expectedVersion: "v1",
				}),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "changed",
		);
	});

	it("answers a paused template and a stale due date in the core's order", async () => {
		const { db } = await open(base.seed, { isActive: false });
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: "t1",
					now: DEC_1,
					clientId: "e1",
					dueAt: new Date("2026-11-01T03:00:00Z"),
					expectedVersion: "v0",
				}),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "not_found",
		);
	});

	it("refuses an absent template, and income, which waits for M4", async () => {
		const { store, db } = await open(base.seed);
		await expect(
			db.write(
				RECURRING_SKIP,
				skipRecurring({ templateId: "nope", now: DEC_1 }),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "not_found",
		);
		await store.transaction((tx) =>
			tx.put("recurringTemplates", { ...template(store), direction: "IN" }),
		);
		const before = dump(store);
		for (const run of [
			() =>
				db.write(
					RECURRING_CONFIRM,
					confirmRecurring({ templateId: "t1", now: DEC_1, clientId: "e1" }),
				),
			() =>
				db.write(
					RECURRING_SKIP,
					skipRecurring({ templateId: "t1", now: DEC_1 }),
				),
			() =>
				db.write(
					RECURRING_CATCH_UP,
					catchUpRecurring({
						templateId: "t1",
						now: DEC_1,
						clientId: () => "p",
						isProtected: notProtected,
					}),
				),
		]) {
			const error = await run().catch((e) => e);
			expect(error).toBeInstanceOf(InvalidInputError);
			expect((error as Error).message).toBe(INCOME_NOT_ON_DEVICE);
		}
		expect(dump(store)).toEqual(before);
	});
});

describe("catch-up stops", () => {
	const catchUp = (isProtected: () => Promise<boolean>) =>
		catchUpRecurring({
			templateId: "t1",
			now: new Date("2026-11-15T12:00:00Z"),
			clientId: (i) => `p${i}`,
			isProtected,
		});
	const threeBehind = () =>
		open({
			...base.seed,
			template: {
				...base.seed.template,
				nextDueDate: new Date("2026-09-01T03:00:00Z"),
			},
			rates: [
				{
					currency: "ARS",
					type: "blue",
					rate: "1545",
					date: new Date("2026-08-01T00:00:00Z"),
				},
			],
		});

	it("stops before the first period when protection is on, and when it cannot be read", async () => {
		const { store, db } = await threeBehind();
		const before = dump(store);
		for (const [isProtected, stopped] of [
			[async () => true, "protected"],
			[
				async () => {
					throw new Error("no key");
				},
				"protection_unreadable",
			],
		] as const) {
			const { value } = await db.write(
				RECURRING_CATCH_UP,
				catchUp(isProtected),
			);
			expect(value).toEqual({ posted: [], stopped });
		}
		expect(dump(store)).toEqual(before);
	});

	it("reads protection again before every later period", async () => {
		const { store, db } = await threeBehind();
		let reads = 0;
		const { value } = await db.write(
			RECURRING_CATCH_UP,
			catchUp(async () => ++reads > 1),
		);
		expect(value.stopped).toBe("protected");
		expect(value.posted.map((e) => e.date.toISOString())).toEqual([
			"2026-09-01T03:00:00.000Z",
		]);
		expect(template(store).nextDueDate.toISOString()).toBe(
			"2026-10-01T03:00:00.000Z",
		);
	});

	it("posts nothing for a paused template or one that no longer pays automatically", async () => {
		for (const over of [{ isActive: false }, { autoPay: false }]) {
			const { store, db } = await open(base.seed, over);
			const { value } = await db.write(
				RECURRING_CATCH_UP,
				catchUpRecurring({
					templateId: "t1",
					now: DEC_1,
					clientId: () => "p",
					isProtected: notProtected,
				}),
			);
			expect(value).toEqual({
				posted: [],
				stopped: "refused",
				refusal: "not_found",
			});
			expect(store.list("expenses")).toEqual([]);
		}
	});
});

describe("preview and undo", () => {
	const actor = { userId: "u1" };
	const runnerOver = (store: Store) =>
		createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => DEC_1 }),
			actor,
		});

	// USD 20 into spent: 20.00 USD (2,000 minor), as the server's confirm lists it.
	it("previews a confirm as the write rolled back, and applies exactly that", async () => {
		const { store } = await open(base.seed);
		const runner = runnerOver(store);
		const input = { templateId: "t1", now: DEC_1, clientId: "e1" };
		const kept = dump(store);
		const preview = await runner.preview(RECURRING_CONFIRM_MUTATION, input);
		expect(dump(store)).toEqual(kept);
		expect(preview.changes).toEqual([
			{
				id: "spent",
				currency: "USD",
				before: null,
				after: { minor: 2_000, currency: "USD" },
				delta: { minor: 2_000, currency: "USD" },
				figureAfter: [{ minor: 2_000, currency: "USD" }],
			},
		]);
		const { undo, ...applied } = await runner.apply(
			RECURRING_CONFIRM_MUTATION,
			input,
		);
		expect(applied).toEqual(preview);
		expect(store.list("expenses")).toHaveLength(1);
		expect(undo).toMatchObject({ kind: "revert", mutation: RECURRING_CONFIRM });
	});

	it("previews a skip as no figure change and a catch-up as the confirms it makes", async () => {
		const { store } = await open(base.seed);
		const runner = runnerOver(store);
		const skip = await runner.preview(RECURRING_SKIP_MUTATION, {
			templateId: "t1",
			now: DEC_1,
		});
		expect(skip.changes).toEqual([]);
		const run = await runner.preview(RECURRING_CATCH_UP_MUTATION, {
			templateId: "t1",
			now: DEC_1,
			clientId: () => "p",
			isProtected: notProtected,
		});
		expect(run.changes.map((c) => [c.id, c.delta.minor])).toEqual([
			["spent", 2_000],
		]);
	});

	it("undoes a confirm, expense and template together, and the undo of the undo redoes it", async () => {
		const { store, db } = await open(base.seed);
		const start = dump(store);
		const { undo } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DEC_1, clientId: "e1" }),
		);
		const done = dump(store);
		const redo = await db.undo(undo);
		expect(dump(store)).toEqual(start);
		await db.undo(redo);
		expect(dump(store)).toEqual(done);
	});

	it("undoes a skip", async () => {
		const { store, db } = await open(base.seed);
		const start = dump(store);
		const { undo } = await db.write(
			RECURRING_SKIP,
			skipRecurring({ templateId: "t1", now: DEC_1 }),
		);
		expect(template(store).nextDueDate.toISOString()).toBe(
			"2027-01-01T03:00:00.000Z",
		);
		await db.undo(undo);
		expect(dump(store)).toEqual(start);
	});

	// Only the newest confirm can be undone: the template must still be where
	// the write left it, as the server's undo requires.
	it("refuses to undo a confirm after a later one moved the template", async () => {
		const { store, db } = await open(base.seed);
		const first = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DEC_1, clientId: "e1" }),
		);
		await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({
				templateId: "t1",
				now: new Date("2027-01-01T03:00:00Z"),
				clientId: "e2",
			}),
		);
		const kept = dump(store);
		await expect(db.undo(first.undo)).rejects.toBeInstanceOf(ConflictError);
		expect(dump(store)).toEqual(kept);
	});
});
