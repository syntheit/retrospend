/**
 * The sync apply layer on hand-built wire pages. Expected values are derived
 * in the comments: the user is Ana, home ARS in Buenos Aires, October 2026.
 */
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";
import { InvalidInputError } from "./port";
import { deviceFigures } from "./registry";
import {
	applySettings,
	applySharesSnapshot,
	applySyncPage,
	type WireCategory,
	type WireExpense,
	type WireShare,
	type WireTemplate,
} from "./sync-apply";

const expense = (id: string, o: Partial<WireExpense> = {}): WireExpense => ({
	id,
	title: "row",
	amount: "1000",
	currency: "ARS",
	date: "2026-10-05T15:00:00.000Z",
	categoryId: null,
	amountInUSD: "0.67",
	exchangeRate: "1500",
	pricingSource: "MANUAL",
	location: null,
	description: null,
	status: "FINALIZED",
	isAmortizedParent: false,
	isAmortizedChild: false,
	parentId: null,
	amortizeMode: "INSTALLMENTS",
	keepInWealth: false,
	recurringTemplateId: null,
	budgetEnvelopeId: null,
	excludeFromAnalytics: false,
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1",
	homeAmount: "1000",
	...o,
});

const category = (id: string, kind = "EXPENSE"): WireCategory => ({
	id,
	name: `Name ${id}`,
	color: "blue",
	icon: null,
	kind,
});

const template = (id: string, categoryId: string | null): WireTemplate => ({
	id,
	name: "Rent",
	amount: "300000",
	currency: "ARS",
	categoryId,
	direction: "OUT",
	amountMode: "FIXED",
	frequency: "MONTHLY",
	nextDueDate: "2026-11-01T03:00:00.000Z",
	anchorDay: 1,
	autoPay: false,
	isActive: true,
});

const share = (id: string, o: Partial<WireShare> = {}): WireShare => ({
	id,
	expenseId: "x1",
	shareAmount: "250",
	verificationStatus: "ACCEPTED",
	currency: "ARS",
	date: "2026-10-06T15:00:00.000Z",
	projectId: null,
	exchangeRate: null,
	expenseCategoryId: null,
	...o,
});

const SETTINGS = {
	homeCurrency: "ARS",
	timeZone: "America/Argentina/Buenos_Aires",
	startDay: 1,
	hiddenProjectIds: [],
	defaultRateTypes: {},
};

const none = { tombstones: [] };

async function apply(
	store: MemoryStore,
	fn: Parameters<MemoryStore["transaction"]>[0],
) {
	await store.transaction(fn);
}

describe("applySyncPage", () => {
	it("puts the rows of a page by id and deletes its tombstones", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) =>
			applySyncPage(tx, "expenses", {
				items: [expense("e1"), expense("e2", { amount: "5.25" })],
				tombstones: [],
			}),
		);
		expect(store.list("expenses").map((e) => e.id)).toEqual(["e1", "e2"]);
		expect(store.get("expenses", "e2")?.amount).toBe("5.25");
		expect(store.get("expenses", "e1")?.date).toEqual(
			new Date("2026-10-05T15:00:00.000Z"),
		);
		// A later page replaces e2 and deletes e1.
		await apply(store, (tx) =>
			applySyncPage(tx, "expenses", {
				items: [expense("e2", { amount: "6" })],
				tombstones: [{ id: "e1" }],
			}),
		);
		expect(store.list("expenses").map((e) => [e.id, e.amount])).toEqual([
			["e2", "6"],
		]);
	});

	// Ana has one ARS 1,000.00 expense in an income category. Before the
	// category is known the row counts as spending (ARS 1,000.00 = 100,000
	// minor); once it arrives as INCOME the row no longer counts; when it is
	// deleted the kind is gone and the row counts again.
	it("gives an expense its category kind whenever the category arrives or goes, in any order", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) => {
			applySettings(tx, SETTINGS);
			applySyncPage(tx, "expenses", {
				items: [expense("e1", { categoryId: "c1" })],
				tombstones: [],
			});
		});
		const spent = async () => {
			const registry = deviceFigures({
				clock: () => new Date("2026-10-15T15:00:00Z"),
			});
			const read = await readFiguresIn(
				store,
				[registry.get("spent")],
				{ userId: "u1" },
				new FigurePass(),
			);
			return read.get("spent");
		};
		expect(store.get("expenses", "e1")?.categoryKind).toBeNull();
		expect(await spent()).toEqual([{ minor: 100_000, currency: "ARS" }]);

		await apply(store, (tx) =>
			applySyncPage(tx, "categories", {
				items: [category("c1", "INCOME")],
				tombstones: [],
			}),
		);
		expect(store.get("expenses", "e1")?.categoryKind).toBe("INCOME");
		expect(await spent()).toEqual([]);

		await apply(store, (tx) =>
			applySyncPage(tx, "categories", {
				items: [],
				tombstones: [{ id: "c1" }],
			}),
		);
		expect(store.get("expenses", "e1")?.categoryKind).toBeNull();
		expect(await spent()).toEqual([{ minor: 100_000, currency: "ARS" }]);
	});

	it("reaches the same rows whether the category or the expense comes first", async () => {
		const pages = {
			cats: { items: [category("c1", "INCOME")], tombstones: [] },
			exp: { items: [expense("e1", { categoryId: "c1" })], tombstones: [] },
		};
		const first = new MemoryStore();
		await apply(first, (tx) => applySyncPage(tx, "categories", pages.cats));
		await apply(first, (tx) => applySyncPage(tx, "expenses", pages.exp));
		const second = new MemoryStore();
		await apply(second, (tx) => applySyncPage(tx, "expenses", pages.exp));
		await apply(second, (tx) => applySyncPage(tx, "categories", pages.cats));
		expect(second.list("expenses")).toEqual(first.list("expenses"));
		expect(first.get("expenses", "e1")?.categoryKind).toBe("INCOME");
	});

	it("gives a template its category name, color and icon when the category arrives, in any order", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) =>
			applySyncPage(tx, "recurringTemplates", {
				items: [template("t1", "c1"), template("t2", null)],
				tombstones: [],
			}),
		);
		expect(store.get("recurringTemplates", "t1")?.category).toBeNull();
		await apply(store, (tx) =>
			applySyncPage(tx, "categories", {
				items: [{ ...category("c1"), icon: "home" }],
				tombstones: [],
			}),
		);
		expect(store.get("recurringTemplates", "t1")?.category).toEqual({
			id: "c1",
			name: "Name c1",
			color: "blue",
			icon: "home",
		});
		expect(store.get("recurringTemplates", "t2")?.category).toBeNull();
		await apply(store, (tx) =>
			applySyncPage(tx, "categories", {
				items: [],
				tombstones: [{ id: "c1" }],
			}),
		);
		expect(store.get("recurringTemplates", "t1")?.category).toBeNull();
	});

	it("refuses a page with a bad decimal before writing any row of it", async () => {
		const store = new MemoryStore();
		const tx = await store.begin();
		expect(() =>
			applySyncPage(tx, "expenses", {
				items: [expense("e1"), expense("e2", { amount: "1e3" })],
				tombstones: [],
			}),
		).toThrow(InvalidInputError);
		expect(tx.list("expenses")).toEqual([]);
		tx.rollback();
	});

	it("refuses a page with a bad instant, a repeated id or a nullable decimal that is not one", async () => {
		const store = new MemoryStore();
		const tx = await store.begin();
		const bad = (items: WireExpense[]) => () =>
			applySyncPage(tx, "expenses", { items, tombstones: [] });
		expect(bad([expense("e1", { date: "yesterday" })])).toThrow(
			InvalidInputError,
		);
		expect(bad([expense("e1"), expense("e1")])).toThrow(InvalidInputError);
		expect(bad([expense("e1", { homeAmount: "12,5" })])).toThrow(
			InvalidInputError,
		);
		expect(tx.list("expenses")).toEqual([]);
		tx.rollback();
	});

	it("accepts a negative amount and applies a page twice as once", async () => {
		const store = new MemoryStore();
		const page = {
			items: [expense("e1", { amount: "-12.50" })],
			tombstones: [],
		};
		await apply(store, (tx) => applySyncPage(tx, "expenses", page));
		const once = store.list("expenses");
		await apply(store, (tx) => applySyncPage(tx, "expenses", page));
		expect(store.list("expenses")).toEqual(once);
		expect(once[0]?.amount).toBe("-12.50");
	});

	it("fills the account tables from their wire rows", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) => {
			applySyncPage(tx, "accounts", {
				items: [
					{
						id: "a1",
						type: "CASH",
						currency: "ARS",
						balance: "950",
						exchangeRate: null,
						exchangeRateType: null,
						interestRate: null,
						minimumPayment: null,
						dueDate: null,
						closedAt: null,
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
				...none,
			});
			applySyncPage(tx, "legs", {
				items: [
					{
						id: "l1",
						accountId: "a1",
						currency: "ARS",
						amount: "-50",
						homeAmount: null,
						homeCurrency: null,
						date: "2026-10-01T00:00:00.000Z",
						source: "TRANSFER",
						createdAt: "2026-10-01T08:00:00.000Z",
					},
				],
				...none,
			});
			applySyncPage(tx, "snapshots", {
				items: [
					{
						id: "s1",
						accountId: "a1",
						date: "2026-01-01T00:00:00.000Z",
						balance: "1000",
						currency: null,
						exchangeRateType: null,
						recordedAt: "2026-01-01T09:00:00.000Z",
					},
				],
				...none,
			});
			applySyncPage(tx, "rateSwitches", {
				items: [
					{
						id: "r1",
						accountId: "a1",
						from: "2026-02-01T00:00:00.000Z",
						type: "blue",
						previousType: null,
						createdAt: "2026-02-01T10:00:00.000Z",
					},
				],
				...none,
			});
		});
		expect(store.get("accounts", "a1")).toMatchObject({
			balance: "950",
			closedAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(store.get("legs", "l1")?.amount).toBe("-50");
		expect(store.get("snapshots", "s1")?.currency).toBeNull();
		expect(store.get("rateSwitches", "r1")?.type).toBe("blue");
	});
});

describe("applySharesSnapshot", () => {
	it("replaces the shares table and drops rows no longer sent", async () => {
		const store = new MemoryStore();
		const owed = {
			owedToYou: { minor: 500_000, currency: "ARS" },
			youOwe: { minor: 200_000, currency: "ARS" },
		};
		await apply(store, (tx) =>
			applySharesSnapshot(tx, {
				items: [
					share("p1"),
					share("p2", { expenseCategoryId: "c1", exchangeRate: "1500" }),
				],
				owed,
			}),
		);
		expect(store.list("shares").map((s) => s.id)).toEqual(["p1", "p2"]);
		// The expense's category rides as the share's categoryId, as the figures read it.
		expect(store.get("shares", "p2")).toMatchObject({
			categoryId: "c1",
			exchangeRate: "1500",
			shareAmount: "250",
		});
		await apply(store, (tx) =>
			applySharesSnapshot(tx, { items: [share("p2")], owed }),
		);
		expect(store.list("shares").map((s) => s.id)).toEqual(["p2"]);
	});

	it("writes the owed row: totals in one currency, or the currencies that keep them out", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) =>
			applySharesSnapshot(tx, {
				items: [],
				owed: {
					owedToYou: { minor: 500_000, currency: "ARS" },
					youOwe: { minor: 0, currency: "ARS" },
				},
			}),
		);
		expect(store.get("owed", "owed")).toEqual({
			id: "owed",
			currency: "ARS",
			owedToYou: 500_000,
			youOwe: 0,
		});
		await apply(store, (tx) =>
			applySharesSnapshot(tx, { items: [], owed: { missingRates: ["XQZ"] } }),
		);
		expect(store.get("owed", "owed")).toEqual({
			id: "owed",
			missingRates: ["XQZ"],
		});
		expect(store.list("owed")).toHaveLength(1);
	});

	it("refuses a snapshot whose owed totals are in two currencies or not whole minor units, writing nothing", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) =>
			applySharesSnapshot(tx, {
				items: [share("p1")],
				owed: { missingRates: [] },
			}),
		);
		const tx = await store.begin();
		const attempt =
			(owed: Parameters<typeof applySharesSnapshot>[1]["owed"]) => () =>
				applySharesSnapshot(tx, { items: [share("p9")], owed });
		expect(
			attempt({
				owedToYou: { minor: 1, currency: "ARS" },
				youOwe: { minor: 1, currency: "USD" },
			}),
		).toThrow(InvalidInputError);
		expect(
			attempt({
				owedToYou: { minor: 1.5, currency: "ARS" },
				youOwe: { minor: 1, currency: "ARS" },
			}),
		).toThrow(InvalidInputError);
		expect(
			attempt({
				owedToYou: { minor: -1, currency: "ARS" },
				youOwe: { minor: 1, currency: "ARS" },
			}),
		).toThrow(InvalidInputError);
		// The old table is untouched: p1 stays, p9 never arrived.
		expect(tx.list("shares").map((s) => s.id)).toEqual(["p1"]);
		tx.rollback();
	});

	it("refuses a bad share decimal", async () => {
		const tx = await new MemoryStore().begin();
		expect(() =>
			applySharesSnapshot(tx, {
				items: [share("p1", { shareAmount: "abc" })],
				owed: { missingRates: [] },
			}),
		).toThrow(InvalidInputError);
		tx.rollback();
	});
});

describe("applySettings", () => {
	it("writes the one settings row and leaves empty default rate types off it", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) => applySettings(tx, SETTINGS));
		const row = store.get("settings", "user");
		expect(row).toEqual({
			id: "user",
			homeCurrency: "ARS",
			timeZone: "America/Argentina/Buenos_Aires",
			startDay: 1,
			hiddenProjectIds: [],
		});
		expect("defaultRateTypes" in (row ?? {})).toBe(false);
	});

	it("keeps default rate types and hidden projects, and a later pull replaces them", async () => {
		const store = new MemoryStore();
		await apply(store, (tx) =>
			applySettings(tx, {
				...SETTINGS,
				startDay: 15,
				hiddenProjectIds: ["pr1"],
				defaultRateTypes: { ARS: "official" },
			}),
		);
		expect(store.get("settings", "user")).toMatchObject({
			startDay: 15,
			hiddenProjectIds: ["pr1"],
			defaultRateTypes: { ARS: "official" },
		});
		await apply(store, (tx) => applySettings(tx, SETTINGS));
		const row = store.get("settings", "user");
		expect(row?.hiddenProjectIds).toEqual([]);
		expect(row?.defaultRateTypes).toBeUndefined();
	});

	it("refuses a start day outside 1 to 28 and writes nothing", async () => {
		const tx = await new MemoryStore().begin();
		for (const startDay of [0, 29, 1.5, Number.NaN])
			expect(() => applySettings(tx, { ...SETTINGS, startDay })).toThrow(
				InvalidInputError,
			);
		expect(tx.list("settings")).toEqual([]);
		// 28 is the last day every month has.
		applySettings(tx, { ...SETTINGS, startDay: 28 });
		expect(tx.get("settings", "user")?.startDay).toBe(28);
		tx.rollback();
	});
});
