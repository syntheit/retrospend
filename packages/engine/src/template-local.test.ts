/**
 * Template create, edit and delete on the device store. Every expected value
 * is derived by hand from the domain's template rules (the stored due instant
 * is the start of the typed day in the SAVED zone; an edit's due date is the
 * new anchor; a frequency alone moves nothing) and runs with the process zone
 * set to Pacific/Auckland, which is none of the saved zones below, so a read
 * of the phone's own zone would give another instant.
 *
 * Zones used: Buenos Aires UTC-3 all year; Tokyo UTC+9 all year; New York
 * UTC-5 in winter and UTC-4 from Mar 8 2026 at 02:00 local.
 */
import {
	RecurringInputRefusal,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EnvelopeRow } from "./book-rows";
import { at, BA, rate } from "./expense-create-vectors";
import { fixtureRow } from "./fixtures";
import { LocalDb } from "./local-db";
import { seededStore } from "./local-expense-create";
import { MemoryStore } from "./memory-store";
import {
	InvalidInputError,
	SETTINGS_ID,
	type Store,
	TABLE_NAMES,
	type TableName,
	type TableRows,
} from "./port";
import { createDevicePreviewRunner, type DeviceMutation } from "./preview";
import { confirmRecurring } from "./recurring-local";
import { deviceFigures } from "./registry";
import {
	createTemplate,
	deleteTemplate,
	TEMPLATE_CREATE,
	TEMPLATE_CREATE_MUTATION,
	TEMPLATE_DELETE,
	TEMPLATE_DELETE_MUTATION,
	TEMPLATE_UPDATE,
	TEMPLATE_UPDATE_MUTATION,
	updateTemplate,
} from "./template-local";
import { type TemplateRow, templateWithoutText } from "./templates";

declare const process: { env: Record<string, string | undefined> };

const originalTZ = process.env.TZ;
beforeEach(() => {
	process.env.TZ = "Pacific/Auckland";
	// NZDT is UTC+13 on Dec 1: proof the process zone took effect.
	expect(new Date("2026-12-01T00:00:00Z").getHours()).toBe(13);
});
afterEach(() => {
	if (originalTZ === undefined) delete process.env.TZ;
	else process.env.TZ = originalTZ;
});

const TOKYO = "Asia/Tokyo";
const NEW_YORK = "America/New_York";

async function open(timeZone = BA) {
	const store = await seededStore({
		homeCurrency: "ARS",
		timeZone,
		rates: [rate("ARS", "blue", "1545", "2026-11-30T00:00:00Z")],
	});
	await store.transaction((tx) => {
		tx.put("categories", {
			id: "cat-out",
			kind: "EXPENSE",
			name: "Housing",
			color: "blue",
			icon: null,
			excludeByDefault: false,
		});
		tx.put("categories", {
			id: "cat-in",
			kind: "INCOME",
			name: "Salary",
			color: "green",
			icon: null,
			excludeByDefault: false,
		});
	});
	return { store, db: new LocalDb(store) };
}

const rent = {
	id: "t1",
	name: "Rent",
	amount: "20",
	currency: "USD",
	frequency: "MONTHLY",
	nextDueDate: "2026-12-01",
} as const;

const create = (
	db: LocalDb,
	over: Partial<Parameters<typeof createTemplate>[0]> = {},
) => db.write(TEMPLATE_CREATE, createTemplate({ ...rent, ...over }));

const edit = (db: LocalDb, input: Parameters<typeof updateTemplate>[0]) =>
	db.write(TEMPLATE_UPDATE, updateTemplate(input));

const stored = (store: Store, id = "t1") => {
	const row = store.list("recurringTemplates").find((t) => t.id === id);
	if (!row) throw new Error(`no template ${id}`);
	return row;
};

const iso = (row: TemplateRow) => row.nextDueDate.toISOString();

/** Puts the saved zone to another one, as the person changing it does. */
async function moveZone(store: Store, timeZone: string) {
	await store.transaction((tx) => {
		const s = tx.get("settings", SETTINGS_ID);
		if (s) tx.put("settings", { ...s, timeZone });
	});
}

// v1's own rules (api-contract template-fields.ts): each of these is a 400 there.
const V1_REFUSED = [
	["an amount in scientific notation", { amount: "1e3" }],
	["a hex amount", { amount: "0x10" }],
	["an amount with nine decimals", { amount: "20.123456789" }],
	["an amount with twelve digits", { amount: "123456789012" }],
	["a zero amount", { amount: "0.00" }],
	["a negative amount", { amount: "-5" }],
	["a blank name", { name: "" }],
	["a name of 192 characters", { name: "x".repeat(192) }],
	["a name with a control character", { name: "Re\u0001nt" }],
	["a name with a lone surrogate", { name: "Rent\ud800" }],
	["a website of 513 characters", { websiteUrl: "x".repeat(513) }],
	["a lower case currency", { currency: "usd" }],
	["a one character currency", { currency: "U" }],
	["an eleven character currency", { currency: "ABCDEFGHIJK" }],
	["February 30", { nextDueDate: "2026-02-30" }],
	["month 13", { nextDueDate: "2026-13-45" }],
	["text for a day", { nextDueDate: "next friday" }],
	["an empty day", { nextDueDate: "" }],
] as const;

describe("create", () => {
	it("a client id, the start of the day in Buenos Aires and the domain's defaults", async () => {
		const { store, db } = await open();
		const { value } = await create(db, { id: "client-made-id" });
		// Dec 1 00:00 at UTC-3 is 03:00Z; the typed day 1 is the anchor.
		expect(value).toEqual({
			id: "client-made-id",
			name: "Rent",
			amount: "20",
			currency: "USD",
			categoryId: null,
			category: null,
			direction: "OUT",
			amountMode: "FIXED",
			frequency: "MONTHLY",
			nextDueDate: at("2026-12-01T03:00:00.000Z"),
			anchorDay: 1,
			websiteUrl: null,
			paymentSource: null,
			autoPay: true,
			isActive: true,
			version: null,
		});
		expect(stored(store, "client-made-id")).toEqual(value);
	});

	it("a taken id is refused and the first template stays", async () => {
		const { store, db } = await open();
		await create(db);
		await expect(create(db, { name: "Other" })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
		expect(stored(store).name).toBe("Rent");
	});

	it("the typed day is read in the saved zone: Tokyo is 15:00Z the day before", async () => {
		const { db } = await open(TOKYO);
		const { value } = await create(db);
		// Dec 1 00:00 at UTC+9 is Nov 30 15:00Z; the anchor is still the typed 1.
		expect(iso(value)).toBe("2026-11-30T15:00:00.000Z");
		expect(value.anchorDay).toBe(1);
	});

	it("a saved-zone change moves the next create, not the template already made", async () => {
		const { store, db } = await open();
		await create(db);
		await moveZone(store, TOKYO);
		await create(db, { id: "t2" });
		expect(iso(stored(store, "t1"))).toBe("2026-12-01T03:00:00.000Z");
		expect(iso(stored(store, "t2"))).toBe("2026-11-30T15:00:00.000Z");
	});

	it("a DST zone: New York midnight is 05:00Z on Mar 8 and 04:00Z on Mar 9", async () => {
		const { db } = await open(NEW_YORK);
		const before = await create(db, { nextDueDate: "2026-03-08" });
		const after = await create(db, { id: "t2", nextDueDate: "2026-03-09" });
		expect(iso(before.value)).toBe("2026-03-08T05:00:00.000Z");
		expect(iso(after.value)).toBe("2026-03-09T04:00:00.000Z");
	});

	it("day 31: Jan 31 anchors 31, and Feb 28 with anchor 31 or 30 keeps it", async () => {
		const { db } = await open();
		const jan = await create(db, { nextDueDate: "2027-01-31" });
		expect(iso(jan.value)).toBe("2027-01-31T03:00:00.000Z");
		expect(jan.value.anchorDay).toBe(31);
		// Feb 2027 has 28 days: the first date is the clamped last day.
		const feb = await create(db, {
			id: "t2",
			nextDueDate: "2027-02-28",
			anchorDay: 31,
		});
		expect(feb.value.anchorDay).toBe(31);
		const thirty = await create(db, {
			id: "t3",
			nextDueDate: "2027-02-28",
			anchorDay: 30,
		});
		expect(thirty.value.anchorDay).toBe(30);
	});

	it("an anchor the first date does not fall on is the domain's refusal", async () => {
		const { store, db } = await open();
		await expect(
			create(db, { nextDueDate: "2027-02-27", anchorDay: 31 }),
		).rejects.toMatchObject({
			constructor: RecurringInputRefusal,
			kind: "anchor_mismatch",
		});
		await expect(create(db, { anchorDay: 32 })).rejects.toMatchObject({
			kind: "anchor_out_of_range",
		});
		expect(store.list("recurringTemplates")).toHaveLength(0);
	});

	it("a weekly template ignores the anchor day and keeps the typed day", async () => {
		const { db } = await open();
		// Wed Jan 7 2026 is the 7th.
		const { value } = await create(db, {
			frequency: "WEEKLY",
			nextDueDate: "2026-01-07",
			anchorDay: 31,
		});
		expect(value.anchorDay).toBe(7);
	});

	it("a category must be an expense category of the person's", async () => {
		const { store, db } = await open();
		await expect(create(db, { categoryId: "cat-in" })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
		await expect(create(db, { categoryId: "nope" })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
		expect(store.list("recurringTemplates")).toHaveLength(0);
		const { value } = await create(db, { categoryId: "cat-out" });
		expect(value.category).toEqual({
			id: "cat-out",
			name: "Housing",
			color: "blue",
			icon: null,
		});
	});

	it("recurring income is refused: it is confirmed and made online", async () => {
		const { store, db } = await open();
		await expect(create(db, { direction: "IN" })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
		expect(store.list("recurringTemplates")).toHaveLength(0);
	});

	it.each(V1_REFUSED)(
		"refuses %s, as v1 does, and stores nothing",
		async (_, bad) => {
			const { store, db } = await open();
			await expect(create(db, bad)).rejects.toBeInstanceOf(InvalidInputError);
			expect(store.list("recurringTemplates")).toHaveLength(0);
		},
	);

	it("accepts what v1 accepts at its limits", async () => {
		const { db } = await open();
		const { value } = await create(db, {
			amount: "99999999999.12345678",
			name: "x".repeat(191),
			currency: "US",
			websiteUrl: "x".repeat(512),
			nextDueDate: "2028-02-29",
		});
		expect(value.amount).toBe("99999999999.12345678");
		// Feb 29 2028 00:00 at UTC-3.
		expect(iso(value)).toBe("2028-02-29T03:00:00.000Z");
		expect(value.anchorDay).toBe(29);
	});

	it("keeps its text in the store; the row that may leave has none", async () => {
		const { store, db } = await open();
		const { value } = await create(db, {
			websiteUrl: "https://sentinel.example",
			paymentSource: "sentinel card",
			categoryId: "cat-out",
		});
		expect(stored(store).websiteUrl).toBe("https://sentinel.example");
		const out = JSON.stringify(templateWithoutText(value));
		for (const text of ["Rent", "sentinel", "Housing"])
			expect(out).not.toContain(text);
	});

	it("undo removes it, and a preview writes nothing", async () => {
		const { store, db } = await open();
		const preview = await db.preview(createTemplate({ ...rent }));
		expect(store.list("recurringTemplates")).toHaveLength(0);
		expect(preview.changes).toHaveLength(1);
		expect(preview.changes[0]).toMatchObject({
			table: "recurringTemplates",
			id: "t1",
			before: null,
		});
		const { undo } = await create(db);
		await db.undo(undo);
		expect(store.list("recurringTemplates")).toHaveLength(0);
	});

	it("books ARS 30,900.00 when the created template is confirmed at blue", async () => {
		const { store, db } = await open();
		await create(db);
		const { value } = await db.write(
			"recurring.confirm",
			confirmRecurring({
				templateId: "t1",
				clientId: "e1",
				now: at("2026-12-01T03:00:00Z"),
			}),
		);
		// 20 USD x 1545 blue = 30,900.00 (official would not have been read).
		expect(value.expense.homeAmount).toBe("30900.00");
		expect(iso(stored(store))).toBe("2027-01-01T03:00:00.000Z");
	});
});

describe("edit", () => {
	async function withRent(timeZone = BA, over: Partial<TemplateRow> = {}) {
		const opened = await open(timeZone);
		await create(opened.db);
		await opened.store.transaction((tx) =>
			tx.put("recurringTemplates", {
				...stored(opened.store),
				version: "v1",
				...over,
			}),
		);
		return opened;
	}

	it("a due date is the new anchor, even a clamped month end", async () => {
		const { store, db } = await withRent(BA, {
			nextDueDate: at("2026-01-31T03:00:00Z"),
			anchorDay: 31,
		});
		const { value } = await edit(db, { id: "t1", nextDueDate: "2026-02-28" });
		// Feb 28 00:00 at UTC-3 is 03:00Z; the typed day 28 replaces anchor 31.
		expect(iso(value)).toBe("2026-02-28T03:00:00.000Z");
		expect(value.anchorDay).toBe(28);
		expect(stored(store)).toEqual(value);
	});

	it("the due date typed under a changed saved zone is that day there", async () => {
		const { store, db } = await withRent();
		await moveZone(store, TOKYO);
		const { value } = await edit(db, { id: "t1", nextDueDate: "2026-12-01" });
		expect(iso(value)).toBe("2026-11-30T15:00:00.000Z");
		expect(value.anchorDay).toBe(1);
	});

	it("a frequency alone moves neither the due date nor the anchor", async () => {
		const { db } = await withRent();
		const { value } = await edit(db, { id: "t1", frequency: "WEEKLY" });
		expect(value.frequency).toBe("WEEKLY");
		expect(iso(value)).toBe("2026-12-01T03:00:00.000Z");
		expect(value.anchorDay).toBe(1);
	});

	it("pause and resume change isActive only, and a paused template can be edited", async () => {
		const { store, db } = await withRent();
		const paused = await edit(db, { id: "t1", isActive: false });
		expect(paused.value).toEqual({
			...stored(store),
			isActive: false,
			version: null,
		});
		expect(iso(paused.value)).toBe("2026-12-01T03:00:00.000Z");
		await edit(db, { id: "t1", amount: "25" });
		expect(stored(store).amount).toBe("25");
		await edit(db, { id: "t1", isActive: true });
		expect(stored(store).isActive).toBe(true);
	});

	it("a paused template cannot be confirmed: the core answers not found", async () => {
		const { db } = await withRent();
		await edit(db, { id: "t1", isActive: false });
		await expect(
			db.write(
				"recurring.confirm",
				confirmRecurring({
					templateId: "t1",
					clientId: "e1",
					now: at("2026-12-01T03:00:00Z"),
				}),
			),
		).rejects.toMatchObject({ kind: "not_found" });
	});

	it("clears the category and the optional text with null", async () => {
		const { db } = await open();
		await create(db, {
			categoryId: "cat-out",
			websiteUrl: "https://a.example",
			paymentSource: "card",
		});
		const { value } = await edit(db, {
			id: "t1",
			categoryId: null,
			websiteUrl: null,
			paymentSource: null,
		});
		expect(value).toMatchObject({
			categoryId: null,
			category: null,
			websiteUrl: null,
			paymentSource: null,
		});
	});

	it("an income category on an expense template is refused", async () => {
		const { store, db } = await withRent();
		await expect(
			edit(db, { id: "t1", categoryId: "cat-in" }),
		).rejects.toBeInstanceOf(InvalidInputError);
		expect(stored(store).version).toBe("v1");
	});

	it("a stale version is `changed` and writes nothing; the version it saw works", async () => {
		const { store, db } = await withRent();
		await expect(
			edit(db, { id: "t1", amount: "25", expectedVersion: "v0" }),
		).rejects.toMatchObject({
			constructor: RecurringRefusal,
			kind: "changed",
			message: "Recurring expense changed",
		});
		expect(stored(store)).toMatchObject({ amount: "20", version: "v1" });
		const { value } = await edit(db, {
			id: "t1",
			amount: "25",
			expectedVersion: "v1",
		});
		expect(value).toMatchObject({ amount: "25", version: null });
	});

	it("an edit that names nothing writes nothing and keeps the version", async () => {
		const { store, db } = await withRent();
		const preview = await db.preview(updateTemplate({ id: "t1" }));
		expect(preview.changes).toEqual([]);
		const { value } = await edit(db, { id: "t1" });
		expect(value.version).toBe("v1");
		expect(stored(store).version).toBe("v1");
	});

	it("an absent template is not found; an income template is refused", async () => {
		const { store, db } = await withRent();
		await expect(edit(db, { id: "gone", amount: "5" })).rejects.toMatchObject({
			kind: "not_found",
		});
		await store.transaction((tx) =>
			tx.put("recurringTemplates", { ...stored(store), direction: "IN" }),
		);
		await expect(edit(db, { id: "t1", amount: "5" })).rejects.toBeInstanceOf(
			InvalidInputError,
		);
	});

	it.each(V1_REFUSED)(
		"refuses %s on an edit, as v1 does, keeping the row",
		async (_, bad) => {
			const { store, db } = await withRent();
			await expect(edit(db, { id: "t1", ...bad })).rejects.toBeInstanceOf(
				InvalidInputError,
			);
			expect(stored(store)).toMatchObject({
				name: "Rent",
				amount: "20",
				version: "v1",
			});
			expect(iso(stored(store))).toBe("2026-12-01T03:00:00.000Z");
		},
	);

	it("undo puts the template back as it was", async () => {
		const { store, db } = await withRent();
		const before = stored(store);
		const { undo } = await edit(db, { id: "t1", amount: "25" });
		await db.undo(undo);
		expect(stored(store)).toEqual(before);
	});
});

describe("delete, for the compare only", () => {
	const envelope = (id: string, target: string | null): EnvelopeRow => ({
		id,
		bookId: "b1",
		groupId: null,
		name: id,
		icon: null,
		color: null,
		kind: "BILL",
		sortOrder: 0,
		targetAmount: null,
		targetMode: "NONE",
		targetCadence: "MONTHLY",
		targetMonthlyAmount: null,
		targetCurrency: null,
		targetDueDate: null,
		targetRepeat: null,
		targetStartMonth: null,
		targetTemplateId: target,
		targetLiabilityId: null,
		leftoverRule: "ROLL",
		leftoverSweepToId: null,
		wealthAccountId: null,
		wealthDedicated: false,
		archivedAt: null,
	});

	it("removes the template, unlinks its expenses and clears the BILL target", async () => {
		const { store, db } = await open();
		await create(db);
		await create(db, { id: "t2", name: "Gym" });
		await db.write(
			"recurring.confirm",
			confirmRecurring({
				templateId: "t1",
				clientId: "e1",
				now: at("2026-12-01T03:00:00Z"),
			}),
		);
		await db.write(
			"recurring.confirm",
			confirmRecurring({
				templateId: "t2",
				clientId: "e2",
				now: at("2026-12-01T03:00:00Z"),
			}),
		);
		await store.transaction((tx) => {
			tx.put("envelopes", envelope("env1", "t1"));
			tx.put("envelopes", envelope("env2", "t2"));
		});
		const { value } = await db.write(
			TEMPLATE_DELETE,
			deleteTemplate({ id: "t1" }),
		);
		expect(value.id).toBe("t1");
		expect(store.list("recurringTemplates").map((t) => t.id)).toEqual(["t2"]);
		const byId = (id: string) =>
			store.list("expenses").find((e) => e.id === id);
		// The expense stays, without the link; the other template's expense keeps its own.
		expect(byId("e1")?.recurringTemplateId).toBeNull();
		expect(byId("e2")?.recurringTemplateId).toBe("t2");
		const targets = Object.fromEntries(
			store.list("envelopes").map((e) => [e.id, e.targetTemplateId]),
		);
		expect(targets).toEqual({ env1: null, env2: "t2" });
	});

	it("an absent template is not found", async () => {
		const { db } = await open();
		await expect(
			db.write(TEMPLATE_DELETE, deleteTemplate({ id: "gone" })),
		).rejects.toMatchObject({ kind: "not_found" });
	});

	it("an income template is deleted too: the compare must match the server", async () => {
		const { store, db } = await open();
		await create(db);
		await store.transaction((tx) =>
			tx.put("recurringTemplates", { ...stored(store), direction: "IN" }),
		);
		await db.write(TEMPLATE_DELETE, deleteTemplate({ id: "t1" }));
		expect(store.list("recurringTemplates")).toHaveLength(0);
	});
});

describe("preview", () => {
	async function runner() {
		const { store, db } = await open();
		const preview = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => at("2026-12-01T12:00:00Z") }),
			actor: { userId: "device" },
		});
		return { store, db, preview };
	}

	it("a create moves the monthly cost figure by 20 USD in ARS and writes nothing", async () => {
		const { store, preview } = await runner();
		const out = await preview.preview(
			TEMPLATE_CREATE_MUTATION as DeviceMutation<unknown, unknown>,
			{ ...rent },
		);
		expect(store.list("recurringTemplates")).toHaveLength(0);
		// 20 USD x 1545 blue = 30,900.00 ARS a month; x3 a quarter, x12 a year.
		expect(
			out.changes.map((c) => [c.id, c.before?.minor, c.after?.minor]),
		).toEqual([
			["recurring.cost.out.month", 0, 3_090_000],
			["recurring.cost.out.quarter", 0, 9_270_000],
			["recurring.cost.out.year", 0, 37_080_000],
		]);
	});

	it("an amount edit moves the template's own amount figure and the cost, and writes nothing", async () => {
		const { store, db, preview } = await runner();
		await create(db);
		const out = await preview.preview(TEMPLATE_UPDATE_MUTATION, {
			id: "t1",
			amount: "25",
		});
		expect(stored(store).amount).toBe("20");
		// USD 20 -> 25 at blue 1545: ARS 30,900.00 -> 38,625.00 a month.
		expect(
			out.changes.map((c) => [c.id, c.before?.minor, c.after?.minor]),
		).toEqual([
			["recurring.cost.out.month", 3_090_000, 3_862_500],
			["recurring.cost.out.quarter", 9_270_000, 11_587_500],
			["recurring.cost.out.year", 37_080_000, 46_350_000],
			// The template's own amount, in its own currency: USD 20.00 -> 25.00.
			["recurring.amount", 2_000, 2_500],
		]);
	});

	it("pausing takes the template out of the monthly cost", async () => {
		const { db, preview } = await runner();
		await create(db);
		const out = await preview.preview(TEMPLATE_UPDATE_MUTATION, {
			id: "t1",
			isActive: false,
		});
		expect(
			out.changes.find((c) => c.id === "recurring.cost.out.month"),
		).toMatchObject({ before: { minor: 3_090_000 }, after: { minor: 0 } });
	});
});

describe("delete of a template a BILL envelope follows", () => {
	const NOW = at("2026-11-14T15:00:00Z");
	const KEY = JSON.stringify([
		"ARS",
		BA,
		"2026-11-05T03:00:00.000Z",
		[[202611, 5, "blue"]],
	]);

	/** ARS home, one book from Nov 5, a BILL envelope following a USD 20 template; blue 1,500. */
	function billStore() {
		const rows = Object.fromEntries(
			TABLE_NAMES.map((t) => [t, [] as unknown[]]),
		) as unknown as { [T in TableName]: TableRows[T][] };
		const filled: typeof rows = {
			...rows,
			settings: [
				{
					id: SETTINGS_ID,
					homeCurrency: "ARS",
					timeZone: BA,
					startDay: 1,
					hiddenProjectIds: [],
				},
			],
			rates: [
				{
					id: "r1",
					currency: "ARS",
					type: "blue",
					rate: "1500",
					date: at("2026-10-01T00:00:00Z"),
				},
			],
			budgetBooks: [
				{
					...fixtureRow("budgetBooks", "book"),
					style: "SAVE_FIRST",
					timeZone: BA,
					startDate: at("2026-11-05T03:00:00Z"),
					startMonth: 202611,
					defaultEnvelopeId: "spending",
					startingBalanceExpenseId: null,
				},
			],
			bookPeriods: [
				{
					id: "p1",
					bookId: "book",
					fromMonth: 202611,
					startDay: 5,
					rateType: "blue",
				},
			],
			envelopeGroups: [
				{
					...fixtureRow("envelopeGroups", "bills"),
					bookId: "book",
					targetKind: "NONE",
					targetValue: null,
				},
			],
			envelopes: [
				{
					...fixtureRow("envelopes", "rent"),
					bookId: "book",
					groupId: "bills",
					kind: "BILL",
					targetAmount: null,
					targetMode: "SET_ASIDE",
					targetTemplateId: "t1",
				},
				{
					...fixtureRow("envelopes", "spending"),
					bookId: "book",
					groupId: "bills",
					kind: "MONTHLY",
					targetAmount: null,
					sortOrder: 1,
				},
			],
			recurringTemplates: [
				{
					...fixtureRow("recurringTemplates", "t1"),
					amount: "20",
					currency: "USD",
					nextDueDate: at("2026-12-01T03:00:00Z"),
				},
			],
			budgetSnapshot: [
				{
					...fixtureRow("budgetSnapshot", "budget"),
					bookId: "book",
					valuationKey: KEY,
				},
			],
		};
		const store = new MemoryStore({ rows: filled });
		const preview = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => NOW }),
			actor: { userId: "device" },
		});
		return { store, db: new LocalDb(store), preview };
	}

	it("previews the plan cost falling from ARS 30,000.00 to nothing", async () => {
		const { store, preview } = billStore();
		const out = await preview.preview(TEMPLATE_DELETE_MUTATION, { id: "t1" });
		// 20 USD x 1500 blue = 30,000.00 a month, in the cost and in the plan.
		expect(
			out.changes.map((c) => [c.id, c.before?.minor, c.after?.minor]),
		).toEqual([
			["recurring.cost.out.month", 3_000_000, 0],
			["recurring.cost.out.quarter", 9_000_000, 0],
			["recurring.cost.out.year", 36_000_000, 0],
			["budget.planCost", 3_000_000, 0],
		]);
		expect(store.list("recurringTemplates")).toHaveLength(1);
	});

	it("undo of the delete puts back the template and the envelope's target", async () => {
		const { store, db } = billStore();
		const before = {
			templates: store.list("recurringTemplates"),
			envelopes: store.list("envelopes"),
		};
		const { undo } = await db.write(
			TEMPLATE_DELETE,
			deleteTemplate({ id: "t1" }),
		);
		expect(store.list("recurringTemplates")).toHaveLength(0);
		expect(store.list("envelopes").find((e) => e.id === "rent")).toMatchObject({
			targetTemplateId: null,
		});
		await db.undo(undo);
		expect({
			templates: store.list("recurringTemplates"),
			envelopes: store.list("envelopes"),
		}).toEqual(before);
	});
});
