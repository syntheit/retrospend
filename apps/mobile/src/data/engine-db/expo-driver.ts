import type * as ExpoSQLite from "expo-sqlite";
import type { SqlDriver, SqlValue } from "./driver";

// The SqlDriver on expo-sqlite's synchronous API. expo-sqlite is required when
// a file is opened or deleted, not when this module loads, so a build or a
// test run without the native half fails at the call (which the engine treats
// as "no database") and not at import.

const sqlite = (): typeof ExpoSQLite => require("expo-sqlite");

function wrap(db: ExpoSQLite.SQLiteDatabase): SqlDriver {
	return {
		exec: (sql) => db.execSync(sql),
		run: (sql, params = []) => {
			db.runSync(sql, [...params]);
		},
		runMany: (sql, lists) => {
			const statement = db.prepareSync(sql);
			try {
				for (const params of lists)
					statement.executeSync([...(params as SqlValue[])]).resetSync();
			} finally {
				statement.finalizeSync();
			}
		},
		all: <T extends object>(sql: string, params: readonly SqlValue[] = []) =>
			db.getAllSync<T>(sql, [...params]),
		transaction: <T>(fn: () => T): T => {
			let result!: T;
			db.withTransactionSync(() => {
				result = fn();
			});
			return result;
		},
		close: () => db.closeSync(),
	};
}

/** A connection of its own to the named file in the app's database folder. */
export function openExpoFile(name: string): SqlDriver {
	return wrap(sqlite().openDatabaseSync(name, { useNewConnection: true }));
}

/** Deletes the file with its journal and write-ahead files. A missing file is not an error. */
export function deleteExpoFile(name: string): void {
	try {
		sqlite().deleteDatabaseSync(name);
	} catch {
		// Absent already, or in use: the next open of this scope starts clean either way.
	}
}
