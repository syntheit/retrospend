import { MemoryStore } from "@retrospend/engine";
import { fixtureRow } from "@retrospend/engine/fixtures";
import { deleteExpoFile, openExpoFile } from "./expo-driver";
import { createPersistence, loadEngineDb } from "./persist";

// expo-sqlite's native half is not in jest, so this stands in for the part of
// its synchronous API the adapter calls, on node:sqlite. It checks that the
// adapter binds, steps, resets and rolls back the way that API documents.

jest.mock("expo-sqlite", () => {
	const { DatabaseSync } = require("node:sqlite");
	const files = new Map<string, InstanceType<typeof DatabaseSync>>();
	const opened: { name: string; options: unknown; closed: boolean }[] = [];
	return {
		__opened: opened,
		openDatabaseSync: (name: string, options: unknown) => {
			let db = files.get(name);
			if (!db) {
				db = new DatabaseSync(":memory:");
				files.set(name, db);
			}
			const handle = { name, options, closed: false };
			opened.push(handle);
			const real = db;
			return {
				execSync: (sql: string) => real.exec(sql),
				runSync: (sql: string, params: unknown[]) => {
					if (!Array.isArray(params)) throw new Error("params must be a list");
					real.prepare(sql).run(...params);
				},
				getAllSync: (sql: string, params: unknown[]) => {
					if (!Array.isArray(params)) throw new Error("params must be a list");
					return real.prepare(sql).all(...params);
				},
				prepareSync: (sql: string) => {
					const statement = real.prepare(sql);
					return {
						executeSync: (params: unknown[]) => {
							statement.run(...params);
							return { resetSync: () => {} };
						},
						finalizeSync: () => {},
					};
				},
				withTransactionSync: (task: () => void) => {
					real.exec("BEGIN");
					try {
						task();
						real.exec("COMMIT");
					} catch (error) {
						real.exec("ROLLBACK");
						throw error;
					}
				},
				closeSync: () => {
					handle.closed = true;
				},
			};
		},
		deleteDatabaseSync: (name: string) => {
			if (!files.has(name)) throw new Error("database not found");
			files.delete(name);
		},
	};
});

const { __opened } = jest.requireMock("expo-sqlite") as {
	__opened: { name: string; options: unknown; closed: boolean }[];
};

describe("the expo-sqlite driver", () => {
	it("opens a connection of its own to the named file", () => {
		openExpoFile("a.db").close();
		expect(__opened.at(-1)).toMatchObject({
			name: "a.db",
			options: { useNewConnection: true },
			closed: true,
		});
	});

	it("runs, reads and binds by position, with prepared batches", () => {
		const db = openExpoFile("b.db");
		db.exec("CREATE TABLE t (a TEXT, b INTEGER)");
		db.run("INSERT INTO t VALUES (?, ?)", ["x", 1]);
		db.runMany("INSERT INTO t VALUES (?, ?)", [
			["y", 2],
			["z", null],
		]);
		expect(db.all("SELECT a, b FROM t WHERE b > ? ORDER BY a", [0])).toEqual([
			{ a: "x", b: 1 },
			{ a: "y", b: 2 },
		]);
		db.close();
	});

	it("returns a transaction's value, and rolls back and rethrows when it throws", () => {
		const db = openExpoFile("c.db");
		db.exec("CREATE TABLE t (a)");
		const value = db.transaction(() => {
			db.run("INSERT INTO t VALUES (1)");
			return "done";
		});
		expect(value).toBe("done");
		expect(() =>
			db.transaction(() => {
				db.run("INSERT INTO t VALUES (2)");
				throw new Error("stop");
			}),
		).toThrow("stop");
		expect(db.all("SELECT a FROM t")).toEqual([{ a: 1 }]);
		db.close();
	});

	it("deletes a file and does not mind one that is already gone", () => {
		openExpoFile("d.db").close();
		deleteExpoFile("d.db");
		expect(() => deleteExpoFile("d.db")).not.toThrow();
	});

	it("carries the engine's rows through a restart", async () => {
		const open = () => {
			const driver = openExpoFile("e.db");
			const loaded = loadEngineDb(driver, "owner");
			const persistence = createPersistence(driver, loaded, {
				cursors: () => ({ expenses: "c1" }),
				onDegraded: () => {},
			});
			const store = new MemoryStore({
				rows: loaded.rows,
				onCommit: (changes) => persistence.commit(changes),
			});
			return { store, persistence, loaded };
		};
		const first = open();
		await first.store.transaction((tx) =>
			tx.put("expenses", fixtureRow("expenses", "e1")),
		);
		first.persistence.close();
		const second = open();
		expect(second.store.get("expenses", "e1")?.date).toBeInstanceOf(Date);
		expect(second.loaded.cursors).toEqual({ expenses: "c1" });
	});
});
