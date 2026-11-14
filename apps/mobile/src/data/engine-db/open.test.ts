import { existsSync } from "node:fs";
import { join } from "node:path";
import { cipherFake } from "../../../test/cipherFake";
import { removeDir, tempDir } from "../../../test/nodeSqlite";
import { engineFileName, engineKeyName, engineScope } from "./names";
import { openEncrypted, wipeScope } from "./open";
import { readIndex } from "./secrets";

const ORIGIN = "https://money.example.test";
const A = engineScope(ORIGIN, "user-a");
const B = engineScope(ORIGIN, "user-b");
const KEY = /^[0-9a-f]{64}$/;

let dir: string;
beforeEach(() => {
	dir = tempDir();
});
afterEach(() => removeDir(dir));

const onDisk = (scope: string) => existsSync(join(dir, engineFileName(scope)));

describe("names", () => {
	it("differ by user and by server, and hide both", () => {
		expect(A).not.toBe(B);
		expect(engineScope("https://other.example.test", "user-a")).not.toBe(A);
		// The same server however it is written.
		expect(engineScope("https://MONEY.example.test/app/", "user-a")).toBe(A);
		for (const name of [engineFileName(A), engineKeyName(A)]) {
			expect(name).not.toContain("user-a");
			expect(name).not.toContain("money");
			expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
		}
	});
});

describe("opening", () => {
	it("keys the file first, makes a key once for the account and reuses it", async () => {
		const fake = cipherFake(dir);
		const first = await openEncrypted(fake.deps, A);
		expect(first).not.toBeNull();
		const key = fake.secrets.values.get(engineKeyName(A));
		expect(key).toMatch(KEY);
		first?.exec("CREATE TABLE t (x)");
		first?.close();

		const again = await openEncrypted(fake.deps, A);
		expect(again?.all("SELECT name FROM sqlite_master")).toEqual([
			{ name: "t" },
		]);
		again?.close();
		expect(fake.draws()).toBe(1);
		expect(fake.secrets.values.get(engineKeyName(A))).toBe(key);
		expect(fake.statements.every((s) => s[0]?.startsWith("PRAGMA key"))).toBe(
			true,
		);
		expect(fake.statements[0]).toEqual([
			`PRAGMA key = "x'<key>'"`,
			"PRAGMA cipher_version",
			"SELECT count(*) FROM sqlite_master",
			"PRAGMA temp_store = MEMORY",
			"CREATE TABLE t (x)",
		]);
	});

	it("gives another account its own key and file", async () => {
		const fake = cipherFake(dir);
		(await openEncrypted(fake.deps, A))?.close();
		(await openEncrypted(fake.deps, B))?.close();
		const keys = [A, B].map((s) => fake.secrets.values.get(engineKeyName(s)));
		expect(keys[0]).toMatch(KEY);
		expect(keys[1]).toMatch(KEY);
		expect(keys[0]).not.toBe(keys[1]);
		expect(onDisk(A) && onDisk(B)).toBe(true);
	});

	it("keeps temp files in memory", async () => {
		const fake = cipherFake(dir);
		const driver = await openEncrypted(fake.deps, A);
		// 2 is MEMORY.
		expect(driver?.all("PRAGMA temp_store")).toEqual([{ temp_store: 2 }]);
		driver?.close();
	});

	it("lists the account before the key or the file exist", async () => {
		const fake = cipherFake(dir);
		let listedBeforeFile: string[] | null = null;
		const open = fake.deps.openFile;
		fake.deps.openFile = (name) => {
			listedBeforeFile = [...fake.secrets.values.keys()];
			return open(name);
		};
		(await openEncrypted(fake.deps, A))?.close();
		expect(listedBeforeFile).toContain(engineKeyName(A));
		expect(await readIndex(fake.secrets)).toEqual([A]);
	});

	it("runs without a database when the build has no SQLCipher, and leaves no file or key", async () => {
		const fake = cipherFake(dir, { cipher: false });
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		expect(fake.files.size).toBe(0);
		expect(onDisk(A)).toBe(false);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
		expect(await readIndex(fake.secrets)).toEqual([]);
		expect(fake.logs.map((l) => l.what)).toEqual([
			"database has no cipher, running without one",
		]);
	});

	it("starts empty under a new key when the key does not open the file", async () => {
		const fake = cipherFake(dir);
		fake.plantForeignFile(engineFileName(A));
		fake.secrets.values.set(engineKeyName(A), "ab".repeat(32));
		const driver = await openEncrypted(fake.deps, A);
		expect(driver).not.toBeNull();
		expect(driver?.all("SELECT name FROM sqlite_master")).toEqual([]);
		driver?.close();
		const key = fake.secrets.values.get(engineKeyName(A));
		expect(key).toMatch(KEY);
		expect(key).not.toBe("ab".repeat(32));
		expect(fake.draws()).toBe(1);
	});

	it("deletes a file whose key is gone and starts empty", async () => {
		const fake = cipherFake(dir);
		fake.plantForeignFile(engineFileName(A));
		const driver = await openEncrypted(fake.deps, A);
		expect(driver?.all("SELECT name FROM sqlite_master")).toEqual([]);
		driver?.close();
		expect(fake.secrets.values.get(engineKeyName(A))).toMatch(KEY);
	});

	it("treats text that is not a key as no key", async () => {
		const fake = cipherFake(dir);
		fake.secrets.values.set(engineKeyName(A), "not a key");
		fake.plantForeignFile(engineFileName(A));
		const driver = await openEncrypted(fake.deps, A);
		expect(driver?.all("SELECT name FROM sqlite_master")).toEqual([]);
		driver?.close();
		expect(fake.secrets.values.get(engineKeyName(A))).toMatch(KEY);
	});

	it("gives up and leaves nothing when a new file still will not open", async () => {
		const fake = cipherFake(dir);
		fake.plantForeignFile(engineFileName(A));
		const open = fake.deps.openFile;
		fake.deps.openFile = (name) => {
			const driver = open(name);
			// A driver that rejects every key.
			fake.files.set(name, "never");
			return driver;
		};
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		expect(onDisk(A)).toBe(false);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
		expect(await readIndex(fake.secrets)).toEqual([]);
	});
});

describe("when there is no safe way to keep a key", () => {
	const nothingLeft = async (fake: ReturnType<typeof cipherFake>) => {
		expect(onDisk(A)).toBe(false);
		expect(fake.files.size).toBe(0);
		expect(
			[...fake.secrets.values.keys()].filter((k) => k.includes("key")),
		).toEqual([]);
	};

	it("runs without a database when the random generator throws", async () => {
		const fake = cipherFake(dir);
		fake.nextBytes.current = () => {
			throw new Error("no secure generator");
		};
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		await nothingLeft(fake);
	});

	it.each([
		["all zero", () => new Uint8Array(32)],
		["too short", () => Uint8Array.from({ length: 16 }, () => 7)],
	])("refuses bytes that are %s", async (_name, bytes) => {
		const fake = cipherFake(dir);
		fake.nextBytes.current = bytes;
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		await nothingLeft(fake);
	});

	it("runs without a database when the keystore cannot save", async () => {
		const fake = cipherFake(dir);
		fake.secrets.failing.set = true;
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		await nothingLeft(fake);
	});

	it("runs without a database when the keystore cannot be read", async () => {
		const fake = cipherFake(dir);
		fake.secrets.failing.get = true;
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		await nothingLeft(fake);
	});

	it("runs without a database when the keystore saves nothing", async () => {
		const fake = cipherFake(dir);
		fake.secrets.set = async () => {};
		expect(await openEncrypted(fake.deps, A)).toBeNull();
		await nothingLeft(fake);
	});

	it("never logs a key", async () => {
		const fake = cipherFake(dir);
		fake.plantForeignFile(engineFileName(A));
		fake.secrets.values.set(engineKeyName(A), "cd".repeat(32));
		(await openEncrypted(fake.deps, A))?.close();
		const key = fake.secrets.values.get(engineKeyName(A)) ?? "";
		expect(JSON.stringify(fake.logs)).not.toContain(key);
		expect(JSON.stringify(fake.logs)).not.toContain("cd".repeat(32));
	});
});

describe("wiping", () => {
	it("removes the file, the key and the index entry of one account only", async () => {
		const fake = cipherFake(dir);
		(await openEncrypted(fake.deps, A))?.close();
		(await openEncrypted(fake.deps, B))?.close();
		await wipeScope(fake.deps, A);
		expect(onDisk(A)).toBe(false);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
		expect(onDisk(B)).toBe(true);
		expect(fake.secrets.values.has(engineKeyName(B))).toBe(true);
		expect(await readIndex(fake.secrets)).toEqual([B]);
	});

	it("keeps the index entry when the key cannot be deleted, so a sweep finds it again", async () => {
		const fake = cipherFake(dir);
		(await openEncrypted(fake.deps, A))?.close();
		fake.secrets.failing.delete = true;
		await expect(wipeScope(fake.deps, A)).rejects.toThrow();
		expect(onDisk(A)).toBe(false);
		expect(await readIndex(fake.secrets)).toEqual([A]);
	});
});
