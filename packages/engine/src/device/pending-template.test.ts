/**
 * The overlay replays a recurring confirm: the posted expense and the
 * template one period on, together or not at all. The entries are made by the
 * real device mutation, so the rows are the ones a confirm writes. Home is ARS
 * at blue 1545 in Buenos Aires; the base template is USD 20 monthly due
 * 2026-12-01T03:00Z, which books ARS 30,900.00 and steps to 2027-01-01T03:00Z.
 */
import { describe, expect, it } from "vitest";
import { withoutText } from "../expenses";
import { LocalDb } from "../local-db";
import { seededStore } from "../local-expense-create";
import type { MemoryStore } from "../memory-store";
import {
	confirmRecurring,
	RECURRING_CONFIRM,
	skipRecurring,
} from "../recurring-local";
import { recurringVectors } from "../recurring-vectors";
import { type TemplateRow, templateWithoutText } from "../templates";
import {
	CREATE_TEXT,
	type PendingChange,
	type PendingEntry,
	readOverlaid,
} from "./pending";

const { seed } = recurringVectors[0] as (typeof recurringVectors)[number];
const DEC_1 = new Date("2026-12-01T03:00:00Z");
const JAN_1 = new Date("2027-01-01T03:00:00Z");

const pulled: TemplateRow = {
	id: "t1",
	name: "Rent",
	amount: "20",
	currency: "USD",
	frequency: "MONTHLY",
	nextDueDate: DEC_1,
	anchorDay: 1,
	direction: "OUT",
	isActive: true,
	autoPay: true,
	amountMode: "FIXED",
	categoryId: null,
	category: null,
	websiteUrl: "https://rent.example",
	paymentSource: "Visa 4242",
	version: "v1",
};

async function open(row: TemplateRow = pulled) {
	const store = await seededStore(seed);
	await store.transaction((tx) => tx.put("recurringTemplates", row));
	return store;
}

/** What an entry for one write holds: the rows it changed, without text. */
async function entryOf(
	store: MemoryStore,
	clientId: string,
	write: Parameters<LocalDb["preview"]>[0],
	over: Partial<PendingEntry> = {},
): Promise<PendingEntry> {
	const { changes } = await new LocalDb(store).preview(write);
	return {
		clientId,
		bookedAt: 0,
		changed: [],
		parked: false,
		...over,
		changes: changes.map((c): PendingChange => {
			const strip = (row: typeof c.before) =>
				row === null
					? null
					: c.table === "expenses"
						? withoutText(row as never)
						: templateWithoutText(row as TemplateRow);
			return {
				table: c.table,
				id: c.id,
				before: strip(c.before),
				after: strip(c.after),
			} as PendingChange;
		}),
	};
}

const confirm = (clientId: string, now: Date) =>
	confirmRecurring({ templateId: "t1", now, clientId });

const view = (store: MemoryStore, entries: PendingEntry[]) =>
	readOverlaid(store, entries, 0, (tx) => ({
		expenses: tx.list("expenses"),
		template: tx.get("recurringTemplates", "t1"),
	}));

describe("the overlay replays a recurring confirm", () => {
	it("shows the posted expense and the template one period on, over the store's own text", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1));
		const seen = await view(store, [e1]);
		expect(seen.expenses.map((e) => [e.id, String(e.homeAmount)])).toEqual([
			["e1", "30900.00"],
		]);
		// The device keeps no text: a created row has the placeholder.
		expect(seen.expenses[0]?.title).toBe(CREATE_TEXT.title);
		expect(seen.template).toMatchObject({
			name: "Rent",
			websiteUrl: "https://rent.example",
			paymentSource: "Visa 4242",
		});
		expect(seen.template?.nextDueDate.toISOString()).toBe(JAN_1.toISOString());
		// The store itself is untouched.
		expect(store.list("expenses")).toEqual([]);
		expect((await view(store, [])).template?.nextDueDate).toEqual(DEC_1);
	});

	it("holds a second confirm against the template its predecessor left", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1));
		// The second entry's before is the first's after: build it on a store that has it.
		const chained = await open();
		await new LocalDb(chained).write(RECURRING_CONFIRM, confirm("e1", DEC_1));
		const e2 = await entryOf(chained, "c2", confirm("e2", JAN_1));
		const seen = await view(store, [e1, e2]);
		expect(seen.expenses.map((e) => e.id)).toEqual(["e1", "e2"]);
		expect(seen.template?.nextDueDate.toISOString()).toBe(
			"2027-02-01T03:00:00.000Z",
		);
		// The second alone does not fit the pulled template: out whole.
		const alone = await view(store, [e2]);
		expect(alone.expenses).toEqual([]);
		expect(alone.template?.nextDueDate).toEqual(DEC_1);
	});

	it("leaves the whole entry out when a pull moved the template", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1));
		// Another device changed the amount: the template is no longer the one the entry saw.
		const moved = await open({ ...pulled, amount: "25", version: "v2" });
		const seen = await view(moved, [e1]);
		expect(seen.expenses).toEqual([]);
		expect(seen.template).toMatchObject({ amount: "25", nextDueDate: DEC_1 });
	});

	it("matches a template by value: an amount written as 20.00 is the same as 20", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1));
		const scaled = await open({ ...pulled, amount: "20.00" });
		expect((await view(scaled, [e1])).expenses).toHaveLength(1);
	});

	// The phone's outbox keeps JSON, where a column that is undefined is simply absent.
	it("reads a column the outbox dropped as null", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1));
		const dropped = {
			...e1,
			changes: e1.changes.map((c) => {
				if (c.table !== "recurringTemplates") return c;
				const { categoryId: _before, ...before } = c.before ?? {};
				const { categoryId: _after, ...after } = c.after ?? {};
				return { ...c, before, after } as PendingChange;
			}),
		};
		expect((await view(store, [dropped])).expenses).toHaveLength(1);
	});

	it("replays a skip: the template moves and no expense appears", async () => {
		const store = await open();
		const skip = await entryOf(
			store,
			"c1",
			skipRecurring({ templateId: "t1", now: DEC_1 }),
		);
		const seen = await view(store, [skip]);
		expect(seen.expenses).toEqual([]);
		expect(seen.template?.nextDueDate.toISOString()).toBe(JAN_1.toISOString());
	});

	// A confirm's answer names the template's new version, not the expense's.
	it("puts an ack's version on the template and leaves the expense without one", async () => {
		const store = await open();
		const e1 = await entryOf(store, "c1", confirm("e1", DEC_1), {
			ack: { version: "v2", pull: 1 },
		});
		const seen = await view(store, [e1]);
		expect(seen.template?.version).toBe("v2");
		expect(seen.expenses[0]?.version).toBeNull();
	});

	it("leaves a parked or unbooked confirm out", async () => {
		const store = await open();
		const write = confirm("e1", DEC_1);
		const parked = await entryOf(store, "c1", write, { parked: true });
		const unbooked = await entryOf(store, "c2", write, { unbooked: "no_rate" });
		const seen = await view(store, [parked, unbooked]);
		expect(seen.expenses).toEqual([]);
		expect(seen.template?.nextDueDate).toEqual(DEC_1);
	});
});
