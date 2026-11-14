/// <reference types="node" />
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { SqlDriver, SqlValue } from "../src/data/engine-db/driver";
import type { OpenDeps } from "../src/data/engine-db/open";
import type { SecretStore } from "../src/data/engine-db/secrets";
import { nodeDriver } from "./nodeSqlite";

// SQLCipher in a test: node:sqlite has no cipher, so this fake gives each file
// the key it was first used with and fails any other key at the first read, the
// way SQLCipher does (SQLITE_NOTADB). It also keeps the statements each
// connection saw, so a test can check that the key came first.

const NOT_A_DATABASE = () =>
	Object.assign(new Error("file is not a database"), { errcode: 26 });

export interface SecretsFake extends SecretStore {
	values: Map<string, string>;
	/** Make the next writes or reads fail, as a keystore that is gone would. */
	failing: { get?: boolean; set?: boolean; delete?: boolean };
}

export function secretsFake(): SecretsFake {
	const values = new Map<string, string>();
	const failing: SecretsFake["failing"] = {};
	return {
		values,
		failing,
		get: async (name) => {
			if (failing.get) throw new Error("keystore");
			return values.get(name) ?? null;
		},
		set: async (name, value) => {
			if (failing.set) throw new Error("keystore");
			values.set(name, value);
		},
		delete: async (name) => {
			if (failing.delete) throw new Error("keystore");
			values.delete(name);
		},
	};
}

export interface CipherFake {
	deps: OpenDeps;
	secrets: SecretsFake;
	logs: { what: string; code?: string }[];
	/** Each connection's statements, in order. */
	statements: string[][];
	/** The key each file in the folder was made with. */
	files: Map<string, string>;
	/** How many times the random source was asked. */
	draws: () => number;
	/** What the random source returns next; the default counts up from 1. */
	nextBytes: { current: (() => Uint8Array) | null };
	/** A file made under a key nobody has. */
	plantForeignFile(name: string): void;
}

export function cipherFake(
	dir: string,
	options: { cipher?: boolean } = {},
): CipherFake {
	const cipher = options.cipher ?? true;
	const secrets = secretsFake();
	const files = new Map<string, string>();
	const statements: string[][] = [];
	const logs: CipherFake["logs"] = [];
	const nextBytes: CipherFake["nextBytes"] = { current: null };
	let draws = 0;

	const remove = (name: string) => {
		files.delete(name);
		for (const suffix of ["", "-journal", "-wal", "-shm"])
			rmSync(join(dir, name + suffix), { force: true });
	};

	function openFile(name: string): SqlDriver {
		const inner = nodeDriver(join(dir, name));
		const seen: string[] = [];
		statements.push(seen);
		let key: string | null = null;
		let checked = false;
		const guard = () => {
			if (checked) return;
			checked = true;
			const made = files.get(name);
			if (made === undefined) files.set(name, key ?? "plaintext");
			else if (made !== key) throw NOT_A_DATABASE();
		};
		const record = (sql: string) =>
			seen.push(sql.replace(/x'[0-9a-f]+'/, "x'<key>'"));
		return {
			...inner,
			exec: (sql) => {
				record(sql);
				const match = /^PRAGMA key = "x'([0-9a-f]+)'"$/.exec(sql);
				if (match) {
					key = match[1] ?? null;
					return;
				}
				guard();
				inner.exec(sql);
			},
			all: <T extends object>(sql: string, params?: readonly SqlValue[]) => {
				record(sql);
				if (sql === "PRAGMA cipher_version")
					return (cipher ? [{ cipher_version: "4.5.7" }] : []) as T[];
				guard();
				return inner.all<T>(sql, params);
			},
			run: (sql, params) => {
				record(sql);
				guard();
				inner.run(sql, params);
			},
			runMany: (sql, lists) => {
				record(sql);
				guard();
				inner.runMany(sql, lists);
			},
			transaction: (fn) => {
				guard();
				return inner.transaction(fn);
			},
		};
	}

	return {
		secrets,
		logs,
		statements,
		files,
		nextBytes,
		draws: () => draws,
		plantForeignFile: (name) => {
			const driver = nodeDriver(join(dir, name));
			driver.exec("CREATE TABLE leftover (x)");
			driver.close();
			files.set(name, "someone else's key");
		},
		deps: {
			secrets,
			random: async (count) => {
				draws += 1;
				if (nextBytes.current) return nextBytes.current();
				return Uint8Array.from(
					{ length: count },
					(_, i) => ((draws + i) % 255) + 1,
				);
			},
			openFile,
			deleteFile: remove,
			log: (what, code) => logs.push({ what, ...(code ? { code } : {}) }),
		},
	};
}
