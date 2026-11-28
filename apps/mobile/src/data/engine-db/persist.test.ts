import { join } from "node:path";
import {
	MemoryStore,
	type PullApi,
	type PullCursors,
	pullAll,
	SINGLE_ROW_IDS,
	sameValue,
	TABLE_NAMES,
	type TableName,
} from "@retrospend/engine";
import { fixtureRow } from "@retrospend/engine/fixtures";
import { nodeDriver, removeDir, tempDir } from "../../../test/nodeSqlite";
import type { SqlDriver } from "./driver";
import {
	createPersistence,
	loadEngineDb,
	SCHEMA_VERSION,
	UPGRADES,
	WRITE_FAILURE_LIMIT,
} from "./persist";

const OWNER = "owner-1";

let dir: string;
beforeEach(() => {
	dir = tempDir();
});
afterEach(() => removeDir(dir));

const file = () => join(dir, "engine.db");

const idFor = (table: TableName) => SINGLE_ROW_IDS[table] ?? "r1";
/** A device on `path`: loaded, with a store that writes every commit through. */
function boot(
	path: string,
	cursors: { current: PullCursors } = { current: {} },
	wrap: (driver: SqlDriver) => SqlDriver = (d) => d,
) {
	const driver = wrap(nodeDriver(path));
	const loaded = loadEngineDb(driver, OWNER);
	cursors.current = loaded.cursors;
	const degraded: string[] = [];
	const persistence = createPersistence(driver, loaded, {
		cursors: () => cursors.current,
		onDegraded: (cause) => degraded.push(cause),
	});
	const store = new MemoryStore({
		rows: loaded.rows,
		onCommit: (changes) => persistence.commit(changes),
	});
	return { driver, loaded, persistence, store, cursors, degraded };
}

describe("round trip", () => {
	it("restores the rows of every table, with Dates and absent optional fields", async () => {
		const first = boot(file());
		await first.store.transaction((tx) => {
			for (const table of TABLE_NAMES)
				tx.put(table, fixtureRow(table, idFor(table)) as never);
		});
		first.persistence.close();

		const second = boot(file());
		expect(second.loaded.wiped).toBe(false);
		expect(second.loaded.rowCount).toBe(TABLE_NAMES.length);
		for (const table of TABLE_NAMES) {
			const want = fixtureRow(table, idFor(table));
			const got = second.store.get(table, idFor(table));
			expect(got).toBeDefined();
			expect(sameValue(got, want)).toBe(true);
		}
		// A date came back as a Date, not as text.
		expect(second.store.get("expenses", "r1")?.date).toBeInstanceOf(Date);
		second.persistence.close();
	});

	it("keeps an optional field absent and a deleted row deleted", async () => {
		const first = boot(file());
		const settings = {
			...fixtureRow("settings", "user"),
			defaultRateTypes: undefined,
		};
		await first.store.transaction((tx) => {
			tx.put("settings", settings);
			tx.put("expenses", fixtureRow("expenses", "e1"));
			tx.put("expenses", fixtureRow("expenses", "e2"));
		});
		await first.store.transaction((tx) => {
			tx.delete("expenses", "e1");
		});
		first.persistence.close();

		const second = boot(file());
		const got = second.store.get("settings", "user");
		expect(Object.hasOwn(got ?? {}, "defaultRateTypes")).toBe(false);
		expect(second.store.list("expenses").map((r) => r.id)).toEqual(["e2"]);
		second.persistence.close();
	});

	it("replaces a row on a second write instead of adding one", async () => {
		const first = boot(file());
		await first.store.transaction((tx) =>
			tx.put("expenses", { ...fixtureRow("expenses", "e1"), amount: "1" }),
		);
		await first.store.transaction((tx) =>
			tx.put("expenses", { ...fixtureRow("expenses", "e1"), amount: "2" }),
		);
		first.persistence.close();
		const second = boot(file());
		expect(second.store.list("expenses").map((r) => r.amount)).toEqual(["2"]);
		second.persistence.close();
	});
});

describe("cursors and the pull-complete flag", () => {
	it("saves the live cursors with each commit, and reads them back", async () => {
		const first = boot(file());
		first.cursors.current = { expenses: "c1" };
		await first.store.transaction((tx) =>
			tx.put("categories", fixtureRow("categories", "c")),
		);
		first.cursors.current = { expenses: "c2" };
		first.persistence.close();
		// The second cursor was never committed with rows: the file holds c1.
		expect(boot(file()).loaded.cursors).toEqual({ expenses: "c1" });
	});

	it("is incomplete until a pull finishes, and finishing saves the cursors with no rows changed", () => {
		const first = boot(file());
		expect(first.loaded.complete).toBe(false);
		first.cursors.current = { expenses: "c9" };
		first.persistence.beginPull();
		first.persistence.finishPull();
		first.persistence.close();

		const second = boot(file());
		expect(second.loaded.complete).toBe(true);
		expect(second.loaded.cursors).toEqual({ expenses: "c9" });
		second.persistence.close();
	});

	it("clears the flag with the first commit of the next pull and not before", async () => {
		const first = boot(file());
		first.persistence.beginPull();
		first.persistence.finishPull();
		first.persistence.beginPull();
		// A pull that stopped before any commit leaves the flag as it was.
		first.persistence.abandonPull();
		first.persistence.close();
		const second = boot(file());
		expect(second.loaded.complete).toBe(true);

		second.persistence.beginPull();
		await second.store.transaction((tx) =>
			tx.put("categories", fixtureRow("categories", "c")),
		);
		second.persistence.close();
		expect(boot(file()).loaded.complete).toBe(false);
	});

	it("does not clear the flag for a commit outside a pull", async () => {
		const first = boot(file());
		first.persistence.beginPull();
		first.persistence.finishPull();
		await first.store.transaction((tx) =>
			tx.put("categories", fixtureRow("categories", "c")),
		);
		first.persistence.close();
		expect(boot(file()).loaded.complete).toBe(true);
	});
});

describe("a write that fails", () => {
	const failing =
		(when: { on: boolean }, error: unknown = new Error("disk")) =>
		(driver: SqlDriver): SqlDriver => ({
			...driver,
			transaction: (fn) => {
				if (when.on) throw error;
				return driver.transaction(fn);
			},
		});

	it("fails the commit and leaves memory and disk as they were", async () => {
		const when = { on: false };
		const first = boot(file(), undefined, failing(when));
		await first.store.transaction((tx) =>
			tx.put("expenses", fixtureRow("expenses", "e1")),
		);
		when.on = true;
		await expect(
			first.store.transaction((tx) =>
				tx.put("expenses", fixtureRow("expenses", "e2")),
			),
		).rejects.toThrow("disk");
		expect(first.store.list("expenses").map((r) => r.id)).toEqual(["e1"]);
		when.on = false;
		first.persistence.close();
		expect(
			boot(file())
				.store.list("expenses")
				.map((r) => r.id),
		).toEqual(["e1"]);
	});

	it("fails the commit for a row the serializer refuses, without touching disk", async () => {
		const first = boot(file());
		const bad = { ...fixtureRow("expenses", "e1"), date: new Date(Number.NaN) };
		await expect(
			first.store.transaction((tx) => tx.put("expenses", bad)),
		).rejects.toThrow("Cannot store an invalid Date at date");
		expect(first.store.list("expenses")).toEqual([]);
		first.persistence.close();
		expect(boot(file()).loaded.rowCount).toBe(0);
	});

	it("gives up the disk copy at the third failure, and the commit then goes on in memory", async () => {
		const when = { on: false };
		const first = boot(file(), undefined, failing(when));
		when.on = true;
		const put = (id: string) =>
			first.store.transaction((tx) =>
				tx.put("expenses", fixtureRow("expenses", id)),
			);
		for (let i = 1; i < WRITE_FAILURE_LIMIT; i++)
			await expect(put(`e${i}`)).rejects.toThrow("disk");
		expect(first.degraded).toEqual([]);
		await put("kept");
		expect(first.degraded).toEqual(["repeated"]);
		expect(first.persistence.state).toBe("degraded");
		expect(first.store.list("expenses").map((r) => r.id)).toEqual(["kept"]);
		// Later commits no longer touch the disk, even if it recovered.
		when.on = false;
		await put("later");
		expect(first.store.list("expenses")).toHaveLength(2);
		// Closing the given-up file does not turn the engine's commits into errors.
		first.persistence.close();
		await put("after close");
		expect(first.store.list("expenses")).toHaveLength(3);
		expect(boot(file()).loaded.rowCount).toBe(0);
	});

	it.each([
		["full", 13],
		["corrupt", 11],
	])("gives up at once when the disk is %s", async (kind, errcode) => {
		const when = { on: false };
		const first = boot(
			file(),
			undefined,
			failing(when, Object.assign(new Error("x"), { errcode })),
		);
		when.on = true;
		await first.store.transaction((tx) =>
			tx.put("expenses", fixtureRow("expenses", "e1")),
		);
		expect(first.degraded).toEqual([kind]);
		expect(first.store.list("expenses")).toHaveLength(1);
	});

	it("refuses commits after close, so a disposed engine cannot write", async () => {
		const first = boot(file());
		first.persistence.close();
		await expect(
			first.store.transaction((tx) =>
				tx.put("expenses", fixtureRow("expenses", "e1")),
			),
		).rejects.toThrow("closed");
		expect(first.store.list("expenses")).toEqual([]);
	});
});

describe("a file that cannot be trusted", () => {
	const seed = async () => {
		const first = boot(file());
		await first.store.transaction((tx) =>
			tx.put("expenses", fixtureRow("expenses", "e1")),
		);
		first.persistence.close();
	};
	const tamper = (sql: string, params: (string | number)[] = []) => {
		const driver = nodeDriver(file());
		driver.run(sql, params);
		driver.close();
	};
	const expectWiped = () => {
		const after = boot(file());
		expect(after.loaded.wiped).toBe(true);
		expect(after.loaded.rowCount).toBe(0);
		expect(after.loaded.complete).toBe(false);
		expect(after.loaded.cursors).toEqual({});
		// It is a usable empty file again, at the current version.
		expect(
			after.driver.all<{ value: string }>(
				"SELECT value FROM meta WHERE key = 'schemaVersion'",
			)[0]?.value,
		).toBe(SCHEMA_VERSION);
		after.persistence.close();
	};

	it("empties a file written before expenses carried a version", async () => {
		await seed();
		tamper("UPDATE meta SET value = '1' WHERE key = 'schemaVersion'");
		expectWiped();
	});

	it("empties a file written before templates carried a version", async () => {
		await seed();
		tamper("UPDATE meta SET value = '2' WHERE key = 'schemaVersion'");
		expectWiped();
	});

	it("empties a file from another schema version", async () => {
		await seed();
		tamper("UPDATE meta SET value = '0' WHERE key = 'schemaVersion'");
		expectWiped();
	});

	it("empties a file that belongs to another owner", async () => {
		await seed();
		tamper("UPDATE meta SET value = 'someone-else' WHERE key = 'origin'");
		expectWiped();
	});

	it("empties a file with a row that is not JSON", async () => {
		await seed();
		tamper("UPDATE rows SET json = ?", ["{not json"]);
		expectWiped();
	});

	it("empties a file with a table the engine does not have", async () => {
		await seed();
		tamper("INSERT INTO rows (tbl, id, json) VALUES (?, ?, ?)", [
			"nonsense",
			"x",
			'{"id":"x"}',
		]);
		expectWiped();
	});

	it("empties a file whose row id differs from its key", async () => {
		await seed();
		tamper("UPDATE rows SET json = ?", ['{"id":"other"}']);
		expectWiped();
	});

	it("empties a file whose single-row table holds another id", async () => {
		await seed();
		tamper("INSERT INTO rows (tbl, id, json) VALUES (?, ?, ?)", [
			"settings",
			"not-user",
			'{"id":"not-user"}',
		]);
		expectWiped();
	});

	it("empties a file with a date marker that is not a date", async () => {
		await seed();
		tamper("UPDATE rows SET json = ?", ['{"id":"e1","date":{"$d":"nope"}}']);
		expectWiped();
	});

	it("empties a file whose cursors are not text", async () => {
		await seed();
		tamper("UPDATE meta SET value = ? WHERE key = 'cursors'", [
			'{"expenses":5}',
		]);
		expectWiped();
	});

	it("lets a failure of the SQL itself reach the caller instead of emptying the file", () => {
		const driver = nodeDriver(file());
		const broken: SqlDriver = {
			...driver,
			all: () => {
				throw Object.assign(new Error("x"), { errcode: 26 });
			},
		};
		expect(() => loadEngineDb(broken, OWNER)).toThrow();
	});
});

describe("loading speed", () => {
	it("loads 10,000 expenses without growing worse than linear", async () => {
		const first = boot(file());
		await first.store.transaction((tx) => {
			for (let i = 0; i < 10_000; i++)
				tx.put("expenses", {
					...fixtureRow("expenses", `e${String(i).padStart(5, "0")}`),
					title: `Expense ${i}`,
				});
		});
		first.persistence.close();

		const started = performance.now();
		const second = boot(file());
		const loadMs = performance.now() - started;
		expect(second.loaded.rowCount).toBe(10_000);
		expect(second.store.list("expenses")).toHaveLength(10_000);
		// A ceiling far above a laptop's few hundred milliseconds: it catches a
		// quadratic load, not a slow machine.
		expect(loadMs).toBeLessThan(5000);
		second.persistence.close();
	});
});

const ENTITIES = [
	"categories",
	"recurringTemplates",
	"expenses",
	"accounts",
	"snapshots",
	"legs",
	"rateSwitches",
	"budgetBooks",
	"envelopeGroups",
	"envelopes",
	"envelopeCategories",
	"budgetMovements",
	"bookPeriods",
	"monthCloses",
	"wealthTransfers",
	"payoffPlans",
	"transfers",
] as const;
const SAVED: PullCursors = Object.fromEntries(
	ENTITIES.map((e) => [e, `saved-${e}`]),
);

describe("a file from before category versions", () => {
	/** What a version 4 file held: a category with no `version`, and one the server deleted while the file slept. */
	const narrow = (id: string) => {
		const row: Record<string, unknown> = { ...fixtureRow("categories", id) };
		delete row.version;
		return row;
	};

	/** A finished pull's file, as the build before this one left it. */
	const versionFourFile = async () => {
		const first = boot(file());
		await first.store.transaction((tx) => {
			for (const entity of ENTITIES)
				tx.put(
					entity,
					(entity === "categories"
						? narrow("r1")
						: fixtureRow(entity, "r1")) as never,
				);
			tx.put("categories", narrow("ghost") as never);
		});
		first.cursors.current = { ...SAVED };
		first.persistence.finishPull();
		first.persistence.close();
		const driver = nodeDriver(file());
		driver.run("UPDATE meta SET value = '4' WHERE key = 'schemaVersion'");
		driver.close();
	};

	it("keeps every other row and cursor, drops the categories and their cursor, and is not complete", async () => {
		await versionFourFile();
		const after = boot(file());
		expect(after.loaded.wiped).toBe(false);
		expect(after.loaded.complete).toBe(false);
		const { categories: _dropped, ...kept } = SAVED;
		expect(after.loaded.cursors).toEqual(kept);
		expect(after.store.list("categories")).toEqual([]);
		for (const entity of ENTITIES.filter((e) => e !== "categories"))
			expect({ entity, held: after.store.list(entity).length }).toEqual({
				entity,
				held: 1,
			});
		expect(
			after.driver.all<{ value: string }>(
				"SELECT value FROM meta WHERE key = 'schemaVersion'",
			)[0]?.value,
		).toBe("5");
		after.persistence.close();
	});

	it("pulls the categories again with no cursor, so each has the server's version and the ghost is gone", async () => {
		await versionFourFile();
		const after = boot(file());
		const asked: string[] = [];
		const empty = (name: string) => async (q: { since?: string }) => {
			asked.push(`${name}(${q.since ?? "-"})`);
			return {
				items: [],
				tombstones: [],
				cursor: `new-${name}`,
				hasMore: false,
			};
		};
		const api = {
			sync: new Proxy(
				{
					settings: async () => ({
						homeCurrency: "ARS",
						timeZone: "America/Argentina/Buenos_Aires",
						startDay: 1,
						hiddenProjectIds: [],
						defaultRateTypes: {},
					}),
					shares: async () => ({}),
					categories: async (q: { since?: string }) => {
						asked.push(`categories(${q.since ?? "-"})`);
						return {
							items: [
								{
									id: "r1",
									name: "Food",
									color: "teal",
									icon: null,
									isFixed: false,
									excludeByDefault: false,
									kind: "EXPENSE",
									version: 7,
								},
							],
							tombstones: [],
							cursor: "new-categories",
							hasMore: false,
						};
					},
				} as Record<string, unknown>,
				{ get: (known, name: string) => known[name] ?? empty(name) },
			),
			currencies: { dailyRates: async () => ({ asOf: null, rates: [] }) },
		} as unknown as PullApi;

		await pullAll(after.store, api, after.cursors.current, { shares: false });

		expect(asked).toContain("categories(-)");
		expect(asked).toContain("expenses(saved-expenses)");
		expect(after.store.list("categories").map((c) => c.id)).toEqual(["r1"]);
		expect(after.store.get("categories", "r1")?.version).toBe(7);
		after.persistence.close();
	});

	it("a file at version 4 of another owner is emptied, not upgraded", async () => {
		await versionFourFile();
		const driver = nodeDriver(file());
		driver.run("UPDATE meta SET value = 'someone-else' WHERE key = 'origin'");
		driver.close();
		const after = boot(file());
		expect(after.loaded.wiped).toBe(true);
		expect(after.loaded.rowCount).toBe(0);
		after.persistence.close();
	});
});

describe("a file from before the Wealth fields", () => {
	// A version 3 file goes 3 -> 4 -> 5, so it pulls categories again as well.
	const REPULLED = [
		"accounts",
		"legs",
		"transfers",
		"wealthTransfers",
		"categories",
	] as const;
	/** What a version 3 file held: these rows without the fields version 4 added. */
	const NARROW: Readonly<Record<string, readonly string[]>> = {
		accounts: [
			"name",
			"inBudget",
			"countedUnits",
			"isLiquid",
			"iconKind",
			"version",
		],
		legs: ["countedUnits", "transferId", "expenseId"],
		transfers: [
			"kind",
			"fromAccountId",
			"fromAmount",
			"countedFromUnits",
			"countedToUnits",
			"note",
		],
		wealthTransfers: ["transferId"],
	};
	const narrow = (table: TableName, id: string) => {
		const row: Record<string, unknown> = { ...fixtureRow(table, id) };
		for (const field of NARROW[table] ?? []) delete row[field];
		return row;
	};
	/** A finished pull's file, as the build before this one left it. */
	const versionThreeFile = async () => {
		const first = boot(file());
		await first.store.transaction((tx) => {
			for (const entity of ENTITIES)
				tx.put(entity, narrow(entity, "r1") as never);
			// A row the server deleted while the file slept: no tombstone will come for it.
			tx.put("accounts", narrow("accounts", "ghost") as never);
		});
		first.cursors.current = { ...SAVED };
		first.persistence.finishPull();
		first.persistence.close();
		const driver = nodeDriver(file());
		driver.run("UPDATE meta SET value = '3' WHERE key = 'schemaVersion'");
		driver.close();
	};

	it("names the steps to the current version, with exactly these entities", () => {
		expect(UPGRADES).toEqual([
			{
				from: "3",
				to: "4",
				repull: ["accounts", "legs", "transfers", "wealthTransfers"],
			},
			{ from: "4", to: "5", repull: ["categories"] },
		]);
		expect(SCHEMA_VERSION).toBe("5");
	});

	it("keeps every other row and cursor, drops those entities' rows and cursors, and is not complete", async () => {
		await versionThreeFile();
		const after = boot(file());
		expect(after.loaded.wiped).toBe(false);
		expect(after.loaded.complete).toBe(false);
		const expected = Object.fromEntries(
			ENTITIES.filter((e) => !(REPULLED as readonly string[]).includes(e)).map(
				(e) => [e, `saved-${e}`],
			),
		);
		expect(after.loaded.cursors).toEqual(expected);
		for (const table of TABLE_NAMES) {
			const kept = (REPULLED as readonly string[]).includes(table) ? 0 : 1;
			const held = after.store.list(table).length;
			if (ENTITIES.includes(table as (typeof ENTITIES)[number]))
				expect({ table, held }).toEqual({ table, held: kept });
		}
		expect(
			after.driver.all<{ value: string }>(
				"SELECT value FROM meta WHERE key = 'schemaVersion'",
			)[0]?.value,
		).toBe("5");
		after.persistence.close();
	});

	it("pulls those again with no cursor, the rest from their cursors, and ends with complete rows and no ghost", async () => {
		await versionThreeFile();
		const after = boot(file());
		const asked: string[] = [];
		const route =
			(name: string, items: unknown[] = []) =>
			async (q: { since?: string }) => {
				asked.push(`${name}(${q.since ?? "-"})`);
				return { items, tombstones: [], cursor: `new-${name}`, hasMore: false };
			};
		const iso = "2026-03-01T00:00:00.000Z";
		const api = {
			sync: {
				settings: async () => ({
					homeCurrency: "ARS",
					timeZone: "America/Argentina/Buenos_Aires",
					startDay: 1,
					hiddenProjectIds: [],
					defaultRateTypes: {},
				}),
				shares: async () => ({}),
				categories: route("categories"),
				recurringTemplates: route("recurringTemplates"),
				expenses: route("expenses"),
				accounts: route("accounts", [
					{
						id: "r1",
						type: "CASH",
						currency: "ARS",
						balance: "50000",
						exchangeRate: null,
						exchangeRateType: null,
						interestRate: null,
						minimumPayment: null,
						dueDate: null,
						closedAt: null,
						createdAt: iso,
						name: "Wallet",
						inBudget: true,
						countedUnits: "2.5",
						isLiquid: false,
						iconKind: "BRAND",
						version: 4,
					},
				]),
				accountSnapshots: route("accountSnapshots"),
				accountLegs: route("accountLegs", [
					{
						id: "r1",
						accountId: "r1",
						currency: "ARS",
						date: iso,
						createdAt: iso,
						amount: "-10",
						source: "TRANSFER",
						homeAmount: null,
						homeCurrency: null,
						countedUnits: "1.5",
						transferId: "r1",
						expenseId: "e9",
					},
				]),
				accountRateTypes: route("accountRateTypes"),
				budgetBooks: route("budgetBooks"),
				envelopeGroups: route("envelopeGroups"),
				envelopes: route("envelopes"),
				envelopeCategories: route("envelopeCategories"),
				budgetMovements: route("budgetMovements"),
				bookPeriods: route("bookPeriods"),
				monthCloses: route("monthCloses"),
				wealthTransfers: route("wealthTransfers", [
					{
						id: "r1",
						bookId: "book-1",
						direction: "TO_WEALTH",
						envelopeId: null,
						date: iso,
						amount: "5000",
						transferId: "r1",
					},
				]),
				payoffPlans: route("payoffPlans"),
				transfers: route("transfers", [
					{
						id: "r1",
						kind: "EXCHANGE",
						date: iso,
						fromAccountId: "r1",
						fromAmount: "20000",
						toAccountId: "r1",
						toAmount: "20",
						toCurrency: "USD",
						feeExpenseId: null,
						countedFromUnits: "0",
						countedToUnits: "0",
						note: "trip",
					},
				]),
			},
			currencies: { dailyRates: async () => ({ asOf: null, rates: [] }) },
		} as unknown as PullApi;
		const before = after.store.list("expenses");

		await pullAll(after.store, api, after.cursors.current, { shares: false });

		for (const entity of ENTITIES) {
			const name =
				entity === "snapshots"
					? "accountSnapshots"
					: entity === "legs"
						? "accountLegs"
						: entity === "rateSwitches"
							? "accountRateTypes"
							: entity;
			const since = (REPULLED as readonly string[]).includes(entity)
				? "-"
				: `saved-${entity}`;
			expect(asked).toContain(`${name}(${since})`);
		}
		expect(after.store.list("accounts").map((r) => r.id)).toEqual(["r1"]);
		expect(after.store.get("accounts", "r1")).toMatchObject({
			name: "Wallet",
			inBudget: true,
			countedUnits: "2.5",
			isLiquid: false,
			iconKind: "BRAND",
			version: 4,
		});
		expect(after.store.get("legs", "r1")).toMatchObject({
			countedUnits: "1.5",
			transferId: "r1",
			expenseId: "e9",
		});
		expect(after.store.get("transfers", "r1")).toMatchObject({
			kind: "EXCHANGE",
			fromAccountId: "r1",
			fromAmount: "20000",
			countedFromUnits: "0",
			countedToUnits: "0",
			note: "trip",
		});
		expect(after.store.get("wealthTransfers", "r1")?.transferId).toBe("r1");
		// The untouched entities' rows are the ones the file held.
		expect(after.store.list("expenses")).toEqual(before);
		after.persistence.close();
	});

	it("a file at the current version is not touched", async () => {
		const first = boot(file());
		await first.store.transaction((tx) =>
			tx.put("accounts", fixtureRow("accounts", "r1")),
		);
		first.cursors.current = { ...SAVED };
		first.persistence.finishPull();
		first.persistence.close();
		const second = boot(file());
		expect(second.loaded.cursors).toEqual(SAVED);
		expect(second.loaded.complete).toBe(true);
		expect(second.store.list("accounts")).toHaveLength(1);
		second.persistence.close();
	});

	it("a version 3 file of another owner is emptied, not upgraded", async () => {
		await versionThreeFile();
		const driver = nodeDriver(file());
		driver.run("UPDATE meta SET value = 'someone-else' WHERE key = 'origin'");
		driver.close();
		const after = boot(file());
		expect(after.loaded.wiped).toBe(true);
		expect(after.loaded.rowCount).toBe(0);
		after.persistence.close();
	});

	it("a version 3 file with unreadable cursors is emptied, not upgraded", async () => {
		await versionThreeFile();
		const driver = nodeDriver(file());
		driver.run("UPDATE meta SET value = '[1]' WHERE key = 'cursors'");
		driver.close();
		const after = boot(file());
		expect(after.loaded.wiped).toBe(true);
		expect(after.loaded.rowCount).toBe(0);
		after.persistence.close();
	});
});
