import { join } from "node:path";
import {
	MemoryStore,
	type PullCursors,
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
		first.persistence.close();
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
