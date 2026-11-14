/// <reference types="node" />
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlValue } from "../src/data/engine-db/driver";

// A SqlDriver on node:sqlite, for tests only (the app runs expo-sqlite). Plain
// SQLite has no cipher, so the SQLCipher steps are the fake's job
// (cipherFake.ts); this driver only has to run the SQL the engine writes.

/** A fresh directory for database files; the caller removes it. */
export function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "engine-db-"));
}

export function removeDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

/** A database at `path`, or in memory when none is given. */
export function nodeDriver(path = ":memory:"): SqlDriver & {
	raw: DatabaseSync;
} {
	const db = new DatabaseSync(path);
	return {
		raw: db,
		exec: (sql) => db.exec(sql),
		run: (sql, params = []) => {
			db.prepare(sql).run(...params);
		},
		runMany: (sql, lists) => {
			const statement = db.prepare(sql);
			for (const params of lists) statement.run(...(params as SqlValue[]));
		},
		all: <T extends object>(sql: string, params: readonly SqlValue[] = []) =>
			db.prepare(sql).all(...params) as T[],
		transaction: (fn) => {
			db.exec("BEGIN");
			try {
				const result = fn();
				db.exec("COMMIT");
				return result;
			} catch (error) {
				try {
					db.exec("ROLLBACK");
				} catch {
					// SQLite may already have rolled back; keep the original error.
				}
				throw error;
			}
		},
		close: () => db.close(),
	};
}
