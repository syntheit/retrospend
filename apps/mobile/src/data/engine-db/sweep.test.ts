import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cipherFake } from "../../../test/cipherFake";
import { removeDir, tempDir } from "../../../test/nodeSqlite";
import { engineFileName, engineKeyName, engineScope } from "./names";
import { openEncrypted } from "./open";
import { readIndex } from "./secrets";
import { registerLiveEngine, sweepEngineDbs } from "./sweep";

const ORIGIN = "https://money.example.test";
const A = engineScope(ORIGIN, "user-a");
const B = engineScope(ORIGIN, "user-b");
const C = engineScope("https://other.example.test", "user-a");

let dir: string;
beforeEach(() => {
	dir = tempDir();
});
afterEach(() => removeDir(dir));

const onDisk = (scope: string) => existsSync(join(dir, engineFileName(scope)));
const open = async (fake: ReturnType<typeof cipherFake>, scope: string) =>
	(await openEncrypted(fake.deps, scope))?.close();

describe("the sweep", () => {
	it("leaves only the kept account's file and key", async () => {
		const fake = cipherFake(dir);
		for (const scope of [A, B, C]) await open(fake, scope);
		await sweepEngineDbs(B, fake.deps);
		expect(onDisk(B)).toBe(true);
		expect(fake.secrets.values.has(engineKeyName(B))).toBe(true);
		for (const gone of [A, C]) {
			expect(onDisk(gone)).toBe(false);
			expect(fake.secrets.values.has(engineKeyName(gone))).toBe(false);
		}
		expect(await readIndex(fake.secrets)).toEqual([B]);
	});

	it("removes everything when nobody is signed in", async () => {
		const fake = cipherFake(dir);
		for (const scope of [A, B]) await open(fake, scope);
		await sweepEngineDbs(null, fake.deps);
		expect(fake.files.size).toBe(0);
		expect([...fake.secrets.values.keys()]).toEqual([
			// The index itself stays, empty.
			"retrospend.engine.index",
		]);
		expect(await readIndex(fake.secrets)).toEqual([]);
	});

	it("after a session ends, a different account's sign-in leaves only its own file", async () => {
		const fake = cipherFake(dir);
		await open(fake, A);
		// The session of A ended on the server: no sign-out, only the sweep.
		await sweepEngineDbs(null, fake.deps);
		// B signs in on the same phone and the engine opens its file.
		await open(fake, B);
		await sweepEngineDbs(B, fake.deps);
		expect(onDisk(A)).toBe(false);
		expect(onDisk(B)).toBe(true);
		expect([...fake.files.keys()]).toEqual([engineFileName(B)]);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
	});

	it("removes a key whose file is already gone", async () => {
		const fake = cipherFake(dir);
		await open(fake, A);
		fake.deps.deleteFile(engineFileName(A));
		await sweepEngineDbs(B, fake.deps);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
		expect(await readIndex(fake.secrets)).toEqual([]);
	});

	it("closes a running engine of another account before its file goes, and not the kept one", async () => {
		const fake = cipherFake(dir);
		for (const scope of [A, B]) await open(fake, scope);
		const order: string[] = [];
		const dispose = (scope: string) => async () => {
			order.push(`close ${scope === A ? "a" : "b"}`);
			expect(onDisk(scope)).toBe(true);
		};
		registerLiveEngine(A, dispose(A));
		registerLiveEngine(B, dispose(B));
		await sweepEngineDbs(B, fake.deps);
		expect(order).toEqual(["close a"]);
		expect(onDisk(A)).toBe(false);
		// B stays registered for the next sweep, and goes then.
		await sweepEngineDbs(null, fake.deps);
		expect(order).toEqual(["close a", "close b"]);
	});

	it("does not close an engine that took its entry back", async () => {
		const fake = cipherFake(dir);
		await open(fake, A);
		const dispose = jest.fn(async () => {});
		registerLiveEngine(A, dispose)();
		await sweepEngineDbs(null, fake.deps);
		expect(dispose).not.toHaveBeenCalled();
		expect(onDisk(A)).toBe(false);
	});

	it("goes on with the other accounts when one cannot be removed, and finds it again later", async () => {
		const fake = cipherFake(dir);
		for (const scope of [A, B]) await open(fake, scope);
		fake.secrets.failing.delete = true;
		await expect(sweepEngineDbs(null, fake.deps)).resolves.toBeUndefined();
		// Files went; keys and index entries stay because their delete failed.
		expect(onDisk(A) || onDisk(B)).toBe(false);
		expect((await readIndex(fake.secrets)).sort()).toEqual([A, B].sort());

		fake.secrets.failing.delete = false;
		await sweepEngineDbs(null, fake.deps);
		expect(await readIndex(fake.secrets)).toEqual([]);
		expect(fake.secrets.values.has(engineKeyName(A))).toBe(false);
	});

	it("does nothing, and does not throw, when the keystore cannot be read", async () => {
		const fake = cipherFake(dir);
		await open(fake, A);
		fake.secrets.failing.get = true;
		await expect(sweepEngineDbs(null, fake.deps)).resolves.toBeUndefined();
		expect(onDisk(A)).toBe(true);
	});

	it("does nothing on a phone that never had an engine database", async () => {
		const fake = cipherFake(dir);
		await sweepEngineDbs(A, fake.deps);
		expect(fake.secrets.values.size).toBe(0);
	});
});

// The release build has no engine; it has the sweep. Whatever the sweep and
// the hook that calls it import must not reach the engine, or the release
// bundle would carry it (scripts/check-release-bundle.sh looks for its name).
describe("the sweep in a build without the engine", () => {
	const root = resolve(__dirname, "../../..");
	const imports = (file: string): string[] => {
		const source = readFileSync(file, "utf8");
		const found = [
			...source.matchAll(
				/(?:from\s+|import\s*\(|import\s+|require\()\s*["']([^"']+)["']/g,
			),
		].map((m) => m[1] as string);
		return found;
	};
	const resolveLocal = (from: string, spec: string): string | null => {
		const base = spec.startsWith("@/")
			? join(root, "src", spec.slice(2))
			: spec.startsWith(".")
				? resolve(dirname(from), spec)
				: null;
		if (!base) return null;
		return [`${base}.ts`, `${base}.tsx`].find((f) => existsSync(f)) ?? null;
	};

	function closure(entry: string) {
		const files = new Set<string>();
		const packages = new Set<string>();
		const visit = (file: string) => {
			if (files.has(file)) return;
			files.add(file);
			for (const spec of imports(file)) {
				const local = resolveLocal(file, spec);
				if (local) visit(local);
				else if (!spec.startsWith(".") && !spec.startsWith("@/"))
					packages.add(spec);
			}
		};
		visit(entry);
		return { files, packages };
	}

	it.each(["sweep.ts", "useEngineSweep.ts"])("%s imports no engine", (name) => {
		const { files, packages } = closure(join(__dirname, name));
		const names = [...files].map((f) => f.slice(f.lastIndexOf("/") + 1));
		expect(
			[...packages].filter((p) => p.startsWith("@retrospend/engine")),
		).toEqual([]);
		for (const engineOnly of [
			"device-engine.ts",
			"persist.ts",
			"storage.ts",
			"serialize.ts",
			"app-deps.ts",
		])
			expect(names).not.toContain(engineOnly);
		for (const file of files)
			expect(readFileSync(file, "utf8")).not.toContain(
				"RetrospendDeviceEngine",
			);
	});
});
