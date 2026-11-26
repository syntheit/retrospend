import { describe, expect, it } from "vitest";
import type { ExpenseRow } from "../expenses";
import { seededStore } from "../local-expense-create";
import { recurringVectors } from "../recurring-vectors";
import type { TemplateRow } from "../templates";
import { createDeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import { readOverlaid } from "./pending";
import { templateSeenOf } from "./rebase";

// Try again on a parked edit reads the row as the last pull left it. ARS home
// in Buenos Aires (UTC-3), so a row dated 02:00Z is the evening before there.

const warn = () => undefined;
const page = (items: unknown[], tombstones: { id: string }[] = []) => ({
	items,
	tombstones,
	cursor: cursor("100"),
	hasMore: false,
});

// USD 100 at a typed rate of 1,600 ARS (ARS 160,000.00), as the server stores it.
const custom = {
	...expense("c1", "100", "2026-03-05T02:00:00.000Z"),
	currency: "USD",
	rateType: "custom",
	homeRate: "1600.000000000000",
	homeAmount: "160000.00",
	exchangeRate: "1",
	title: "Taxi",
};

describe("storedRebase", () => {
	it("keeps the typed rate and names the local day, with the pulled version", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		expect(await engine.storedRebase("c1")).toEqual({
			body: {
				id: "c1",
				title: "Taxi",
				amount: "100",
				currency: "USD",
				// 02:00Z on the 5th is 23:00 on the 4th at UTC-3.
				date: "2026-03-04",
				customRate: "1600",
				excludeFromAnalytics: false,
			},
			version: "2026-03-05T02:00:00.000Z",
		});
	});

	it("is null for a row that is not there, and before any pull", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		expect(await engine.storedRebase("c1")).toBeNull();
		await engine.pull();
		expect(await engine.storedRebase("nope")).toBeNull();
	});
});

describe("absentSince", () => {
	const twoPulls = () =>
		fakeDeviceApi({
			expenses: [page([custom]), page([], [{ id: "c1" }])],
		});

	it("is true only once a pull that began after the mark finished without the row", async () => {
		const { api } = twoPulls();
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		// The 404 came while pull 1 was the latest begun: it saw the row, so it resolves nothing.
		expect(await engine.absentSince("c1", engine.pullsBegun)).toBe(false);
		expect(await engine.absentSince("c1", 0)).toBe(false);
		await engine.pull();
		// Pull 2 began after a mark of 1, and the row is gone.
		expect(await engine.absentSince("c1", 1)).toBe(true);
		// A 404 that arrived while pull 2 ran: pull 2 began before it.
		expect(await engine.absentSince("c1", 2)).toBe(false);
	});

	it("is false while the row is still in the store, whatever the pull number", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		await engine.pull();
		expect(await engine.absentSince("c1", 0)).toBe(false);
	});
});

describe("templateSeenOf", () => {
	const { seed } = recurringVectors[0] as (typeof recurringVectors)[number];
	const DEC_1 = new Date("2026-12-01T03:00:00Z");
	const JAN_1 = new Date("2027-01-01T03:00:00Z");
	const template = (over: Partial<TemplateRow> = {}) =>
		({
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
			websiteUrl: null,
			paymentSource: null,
			version: "v1",
			...over,
		}) as TemplateRow;
	const seen = async (rows: {
		template?: TemplateRow;
		expenses?: object[];
	}) => {
		const store = await seededStore(seed);
		await store.transaction((tx) => {
			if (rows.template) tx.put("recurringTemplates", rows.template);
			for (const e of rows.expenses ?? []) tx.put("expenses", e as ExpenseRow);
		});
		return readOverlaid(store, [], 0, (view) =>
			templateSeenOf(view, "t1", DEC_1, "e1"),
		);
	};

	it("is not found for a template the store does not have", async () => {
		expect(await seen({})).toEqual({ found: false });
	});

	it("a template still due on the period is not passed, paused or posted", async () => {
		expect(await seen({ template: template() })).toEqual({
			found: true,
			paused: false,
			passed: false,
			posted: false,
			version: "v1",
		});
	});

	it("a next due date past the period is passed, and the expense the write named is posted", async () => {
		const posted = { id: "e1", date: DEC_1, recurringTemplateId: "t1" };
		expect(
			await seen({
				template: template({ nextDueDate: JAN_1 }),
				expenses: [posted],
			}),
		).toEqual({
			found: true,
			paused: false,
			passed: true,
			posted: true,
			version: "v1",
		});
	});

	it("a paid-on confirm booked on another day is posted by its id, not by the due date", async () => {
		const paidOn = {
			id: "e1",
			date: new Date("2026-11-29T03:00:00Z"),
			recurringTemplateId: "t1",
		};
		expect(
			await seen({
				template: template({ nextDueDate: JAN_1 }),
				expenses: [paidOn],
			}),
		).toMatchObject({ posted: true });
	});

	it("another expense of the template dated the period, or the named id under another template, is not the write's post", async () => {
		const sameDay = { id: "e9", date: DEC_1, recurringTemplateId: "t1" };
		const otherTemplate = { id: "e1", date: DEC_1, recurringTemplateId: "t2" };
		const rows = { template: template({ nextDueDate: JAN_1 }) };
		expect(await seen({ ...rows, expenses: [sameDay] })).toMatchObject({
			posted: false,
		});
		expect(await seen({ ...rows, expenses: [otherTemplate] })).toMatchObject({
			posted: false,
		});
	});

	it("a paused template is paused", async () => {
		expect(
			await seen({ template: template({ isActive: false }) }),
		).toMatchObject({ paused: true });
	});
});

describe("templateSince", () => {
	it("answers only once a pull that began after the mark has finished", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom]), page([])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		const due = new Date("2026-12-01T03:00:00Z");
		await engine.pull();
		// The answer came while pull 1 was the latest begun: it resolves nothing.
		expect(
			await engine.templateSince("t1", engine.pullsBegun, due, "e1"),
		).toBeNull();
		expect(await engine.templateSince("t1", 0, due, "e1")).toEqual({
			found: false,
		});
	});
});
