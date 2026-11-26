/**
 * Recurring income on the device: a confirm, a skip and the poster take an
 * income template through the same plans as an expense one, so the row is the
 * server sweep's: money in (direction IN, inType INCOME), no account leg, one
 * more due date stepped in UTC. Home is ARS at blue 1545, saved zone Buenos
 * Aires; the template is USD 1,000 monthly, due 2026-12-01T00:00Z (a UTC
 * midnight, Nov 30 21:00 in Buenos Aires). Hand-derived: 1,000 x 1545 =
 * ARS 1,545,000.00. The zone vectors run in recurring-conformance.test.ts.
 */
import { RecurringRefusal } from "@retrospend/domain/recurring-post/refusals";
import { describe, expect, it } from "vitest";
import { dump } from "./local-fixtures";
import { InvalidInputError, TABLE_NAMES } from "./port";
import {
	createDevicePreviewRunner,
	RECURRING_CONFIRM_MUTATION,
} from "./preview";
import {
	confirmRecurring,
	RECURRING_CONFIRM,
	RECURRING_SKIP,
	skipRecurring,
} from "./recurring-local";
import { open, runPoster, template } from "./recurring-local-kit";
import { type RecurringVector, recurringVectors } from "./recurring-vectors";
import { deviceFigures } from "./registry";
import {
	INCOME_NOT_ON_DEVICE,
	TEMPLATE_UPDATE,
	updateTemplate,
} from "./template-local";

const base = recurringVectors[0] as RecurringVector;
const DUE = new Date("2026-12-01T00:00:00Z");
const NEXT = "2027-01-01T00:00:00.000Z";
const income = { direction: "IN", amount: "1000", nextDueDate: DUE } as const;
const openIncome = (over: Parameters<typeof open>[1] = {}) =>
	open(base.seed, { ...income, ...over });

const otherTables = (store: Parameters<typeof dump>[0]) =>
	Object.fromEntries(
		TABLE_NAMES.filter(
			(t) => t !== "expenses" && t !== "recurringTemplates",
		).map((t) => [t, store.list(t)]),
	);

describe("an income template on the device", () => {
	it("a confirm books the sweep's row: money in, no account leg, the template one UTC month on", async () => {
		const { store, db } = await openIncome();
		const others = otherTables(store);
		const { value } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DUE, clientId: "e1" }),
		);
		expect(value.expense).toMatchObject({
			id: "e1",
			title: "Rent",
			status: "FINALIZED",
			direction: "IN",
			inType: "INCOME",
			entryKind: "STANDARD",
			pricingSource: "RECURRING",
			recurringTemplateId: "t1",
			excludeFromAnalytics: false,
			currency: "USD",
			amount: "1000",
			homeCurrency: "ARS",
			homeRate: "1545",
			homeAmount: "1545000.00",
			rateType: "blue",
			date: DUE,
		});
		expect(value.template.nextDueDate.toISOString()).toBe(NEXT);
		expect(template(store)).toMatchObject({ version: null, anchorDay: 1 });
		// Nothing but the expense and the template moved: no account, no plan.
		expect(otherTables(store)).toEqual(others);
	});

	it("a confirm is due from the start of the zone's day, not the UTC day: Nov 30 21:00 in Buenos Aires posts", async () => {
		const { db } = await openIncome();
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({ templateId: "t1", now: DUE, clientId: "e1" }),
			),
		).resolves.toBeDefined();
	});

	it("a skip reads the UTC day: not due at Nov 30 21:00 in Buenos Aires, due at 03:00Z", async () => {
		const { store, db } = await openIncome();
		const before = dump(store);
		await expect(
			db.write(RECURRING_SKIP, skipRecurring({ templateId: "t1", now: DUE })),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "not_due",
		);
		expect(dump(store)).toEqual(before);
		// Buenos Aires is Dec 1 00:00 at 03:00Z.
		await db.write(
			RECURRING_SKIP,
			skipRecurring({
				templateId: "t1",
				now: new Date("2026-12-01T03:00:00Z"),
			}),
		);
		expect(template(store).nextDueDate.toISOString()).toBe(NEXT);
		expect(store.list("expenses")).toEqual([]);
	});

	it("a confirm and its undo leave the store as it was, and the undo of the undo redoes it", async () => {
		const { store, db } = await openIncome();
		const start = dump(store);
		const { undo } = await db.write(
			RECURRING_CONFIRM,
			confirmRecurring({ templateId: "t1", now: DUE, clientId: "e1" }),
		);
		const done = dump(store);
		const redo = await db.undo(undo);
		expect(dump(store)).toEqual(start);
		await db.undo(redo);
		expect(dump(store)).toEqual(done);
	});

	// An income row is money in: the expense figures a confirm lists (spent, the
	// home total) do not count it, so the preview shows no spending change.
	it("previews a confirm as the write rolled back, with no spending change, and applies exactly that", async () => {
		const { store } = await openIncome();
		const runner = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => DUE }),
			actor: { userId: "u1" },
		});
		const input = { templateId: "t1", now: DUE, clientId: "e1" };
		const kept = dump(store);
		const preview = await runner.preview(RECURRING_CONFIRM_MUTATION, input);
		expect(dump(store)).toEqual(kept);
		expect(preview.changes).toEqual([]);
		const { undo: _undo, ...applied } = await runner.apply(
			RECURRING_CONFIRM_MUTATION,
			input,
		);
		expect(applied).toEqual(preview);
		expect(store.list("expenses")).toHaveLength(1);
	});

	it("an edit of an income template stays online", async () => {
		const { store, db } = await openIncome();
		const before = dump(store);
		const error = await db
			.write(TEMPLATE_UPDATE, updateTemplate({ id: "t1", amount: "1200" }))
			.catch((e) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect((error as Error).message).toBe(INCOME_NOT_ON_DEVICE);
		expect(dump(store)).toEqual(before);
	});
});

describe("the poster over an income template", () => {
	it("plans and books one entry at the due instant's rate, named by the pulled version", async () => {
		const { store, db } = await openIncome();
		const run = await runPoster(db, { now: DUE });
		expect(run.stopped).toBe("caught_up");
		expect(run.plan.entries.map((e) => e.expectedStamp)).toEqual([
			{ version: "v1" },
		]);
		expect(run.posted).toHaveLength(1);
		expect(run.posted[0]).toMatchObject({
			direction: "IN",
			inType: "INCOME",
			homeAmount: "1545000.00",
		});
		expect(template(store).nextDueDate.toISOString()).toBe(NEXT);
	});

	it("waits for the due instant: nothing one second before", async () => {
		const { store, db } = await openIncome();
		const before = dump(store);
		const run = await runPoster(db, {
			now: new Date("2026-11-30T23:59:59Z"),
		});
		expect(run).toMatchObject({ posted: [], stopped: "caught_up" });
		expect(dump(store)).toEqual(before);
	});

	it("stops when protection is on or cannot be read, writing nothing", async () => {
		const { store, db } = await openIncome();
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
			const run = await runPoster(db, { now: DUE, isProtected });
			expect(run).toMatchObject({ posted: [], stopped });
		}
		expect(dump(store)).toEqual(before);
	});

	it("plans nothing when auto-post is off or the template has no version to name", async () => {
		const off = await openIncome();
		expect(
			await runPoster(off.db, { now: DUE, autoPost: false }),
		).toMatchObject({ posted: [], stopped: "auto_post_off" });
		const unstamped = await openIncome({ version: null });
		expect(await runPoster(unstamped.db, { now: DUE })).toMatchObject({
			posted: [],
			stopped: "no_stamp",
		});
		expect(off.store.list("expenses")).toEqual([]);
		expect(unstamped.store.list("expenses")).toEqual([]);
	});

	it("the auto guard: a template that stopped paying itself or asks for an amount is not found", async () => {
		for (const over of [
			{ autoPay: false },
			{ amountMode: "ASK" as const },
			{ isActive: false },
		]) {
			const { store, db } = await openIncome(over);
			const run = await runPoster(db, { now: DUE });
			expect(run).toMatchObject({
				posted: [],
				stopped: "refused",
				refusal: "not_found",
			});
			// The confirm the entry would send is refused the same way.
			await expect(
				db.write(
					RECURRING_CONFIRM,
					confirmRecurring({
						templateId: "t1",
						now: DUE,
						clientId: "p0",
						dueAt: DUE,
						auto: true,
					}),
				),
			).rejects.toSatisfy(
				(e) => e instanceof RecurringRefusal && e.kind === "not_found",
			);
			expect(store.list("expenses")).toEqual([]);
		}
	});

	it("an entry whose template changed after planning is refused as changed", async () => {
		const { store, db } = await openIncome();
		await store.transaction((tx) =>
			tx.put("recurringTemplates", { ...template(store), version: "v2" }),
		);
		const before = dump(store);
		await expect(
			db.write(
				RECURRING_CONFIRM,
				confirmRecurring({
					templateId: "t1",
					now: DUE,
					clientId: "p0",
					dueAt: DUE,
					auto: true,
					expectedVersion: "v1",
				}),
			),
		).rejects.toSatisfy(
			(e) => e instanceof RecurringRefusal && e.kind === "changed",
		);
		expect(dump(store)).toEqual(before);
	});
});
