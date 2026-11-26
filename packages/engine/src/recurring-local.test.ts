/**
 * Recurring confirm, skip and the poster's per-entry confirms on the device
 * store: the preview, undo and refusal behavior around them. The hand-derived
 * vectors (recurring-vectors.ts) run in recurring-conformance.test.ts. Home is
 * ARS at blue 1545 in Buenos Aires unless a case says otherwise.
 */

import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { RecurringRefusal } from "@retrospend/domain/recurring-post/refusals";
import { describe, expect, it } from "vitest";
import { ConflictError } from "./errors";
import { dump } from "./local-fixtures";
import type { Store } from "./port";
import {
	createDevicePreviewRunner,
	RECURRING_CONFIRM_MUTATION,
	RECURRING_SKIP_MUTATION,
} from "./preview";
import {
	confirmRecurring,
	planPosterOver,
	RECURRING_CONFIRM,
	RECURRING_SKIP,
	skipRecurring,
} from "./recurring-local";
import { notProtected, open, runPoster, template } from "./recurring-local-kit";
import { type RecurringVector, recurringVectors } from "./recurring-vectors";
import { deviceFigures, GLANCE_SPENT } from "./registry";

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

	it("refuses an absent template", async () => {
		const { db } = await open(base.seed);
		await expect(
			db.write(
				RECURRING_SKIP,
				skipRecurring({ templateId: "nope", now: DEC_1 }),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "not_found",
		);
	});
});

describe("poster runs", () => {
	const midNovember = new Date("2026-11-15T12:00:00Z");
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
			const run = await runPoster(db, { now: midNovember, isProtected });
			expect(run).toMatchObject({ posted: [], stopped });
		}
		expect(dump(store)).toEqual(before);
	});

	it("reads protection again before every later period", async () => {
		const { store, db } = await threeBehind();
		let reads = 0;
		const run = await runPoster(db, {
			now: midNovember,
			isProtected: async () => ++reads > 1,
		});
		expect(run.stopped).toBe("protected");
		expect(run.posted.map((e) => e.date.toISOString())).toEqual([
			"2026-09-01T03:00:00.000Z",
		]);
		expect(template(store).nextDueDate.toISOString()).toBe(
			"2026-10-01T03:00:00.000Z",
		);
	});

	it("plans nothing when the server's auto-post setting is off", async () => {
		const { store, db } = await threeBehind();
		const before = dump(store);
		const run = await runPoster(db, { now: midNovember, autoPost: false });
		expect(run).toMatchObject({ posted: [], stopped: "auto_post_off" });
		expect(dump(store)).toEqual(before);
	});

	it("plans nothing for a template with no version to name", async () => {
		const { store, db } = await open(base.seed, { version: null });
		const before = dump(store);
		const run = await runPoster(db, { now: DEC_1 });
		expect(run).toMatchObject({ posted: [], stopped: "no_stamp" });
		expect(dump(store)).toEqual(before);
	});

	it("plans nothing for a paused template or one that no longer pays automatically", async () => {
		for (const over of [{ isActive: false }, { autoPay: false }]) {
			const { store, db } = await open(base.seed, over);
			const run = await runPoster(db, { now: DEC_1 });
			expect(run).toMatchObject({
				posted: [],
				stopped: "refused",
				refusal: "not_found",
			});
			expect(store.list("expenses")).toEqual([]);
		}
	});

	// The first entry carries the stamp the run was planned at. The web changes
	// the amount after the plan: the version moved, so the confirm answers
	// "changed" and books nothing, at the old amount.
	it("books nothing for an entry whose template changed after planning", async () => {
		const { store, db } = await open(base.seed);
		const plan = await planPosterOver(db.reads(), {
			templateId: "t1",
			now: DEC_1,
			autoPost: true,
			isProtected: notProtected,
		});
		const entry = plan.entries[0];
		expect(entry?.expectedStamp).toEqual({ version: "v1" });
		await store.transaction((tx) =>
			tx.put("recurringTemplates", {
				...template(store),
				amount: "25",
				version: "v2",
			}),
		);
		const before = dump(store);
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: "t1",
					now: DEC_1,
					clientId: "p0",
					dueAt: entry?.dueAt,
					auto: true,
					expectedVersion: "v1",
				}),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "changed",
		);
		expect(dump(store)).toEqual(before);
	});

	// Without a stamp the auto flag is what refuses it: auto-pay off is "not found".
	it("an auto confirm refuses a template that stopped paying automatically", async () => {
		const { store, db } = await open(base.seed, { autoPay: false });
		const before = dump(store);
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: "t1",
					now: DEC_1,
					clientId: "p0",
					dueAt: DEC_1,
					auto: true,
				}),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "not_found",
		);
		expect(dump(store)).toEqual(before);
	});

	it("chains a run: the first entry names the pulled version, the rest 'after'", async () => {
		const { db } = await threeBehind();
		const run = await runPoster(db, { now: midNovember });
		expect(run.plan.entries.map((e) => e.expectedStamp)).toEqual([
			{ version: "v1" },
			{ after: 0 },
			{ after: 1 },
		]);
		expect(run.posted).toHaveLength(3);
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

	// USD 20 into spent: 20.00 USD (2,000 minor). Glance.spent totals in ARS:
	// 20 x 1,545 = 30,900.00 = 3,090,000 minor, from 0. The server's confirm
	// lists both, as expense.create does.
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
			{
				id: "glance.spent",
				currency: "ARS",
				before: { minor: 0, currency: "ARS" },
				after: { minor: 3_090_000, currency: "ARS" },
				delta: { minor: 3_090_000, currency: "ARS" },
				figureAfter: [{ minor: 3_090_000, currency: "ARS" }],
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

	it("previews a skip as no figure change", async () => {
		const { store } = await open(base.seed);
		const skip = await runnerOver(store).preview(RECURRING_SKIP_MUTATION, {
			templateId: "t1",
			now: DEC_1,
		});
		expect(skip.changes).toEqual([]);
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
