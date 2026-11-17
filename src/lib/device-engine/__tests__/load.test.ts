import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The mock's factory runs only when something imports the client, so its
// counter says whether the page ever reached it.
const client = vi.hoisted(() => ({
	imported: 0,
	spawned: vi.fn(() => ({ dead: false })),
}));
vi.mock("../client", () => {
	client.imported += 1;
	return { spawnDeviceClient: client.spawned };
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	client.imported = 0;
	client.spawned.mockClear();
});

describe("the dev flag", () => {
	it.each(["", "0", "true", "yes"])(
		"%j never imports the client",
		async (flag) => {
			vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", flag);
			const { loadDeviceClient } = await import("../load");
			expect(await loadDeviceClient()).toBeNull();
			expect(client.imported).toBe(0);
			expect(client.spawned).not.toHaveBeenCalled();
		},
	);

	it("is off when unset", async () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", undefined);
		const { loadDeviceClient } = await import("../load");
		expect(await loadDeviceClient()).toBeNull();
		expect(client.imported).toBe(0);
	});

	it('imports the client and spawns a worker only for "1"', async () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		const { loadDeviceClient } = await import("../load");
		expect(await loadDeviceClient()).toEqual({ dead: false });
		expect(client.imported).toBe(1);
		expect(client.spawned).toHaveBeenCalledTimes(1);
	});
});

describe("what the page's bundle may reach", () => {
	const dir = join(__dirname, "..");
	const read = (file: string) => readFileSync(join(dir, file), "utf8");

	it("reaches the client, the worker and the engine only through the guarded import", () => {
		// Static imports (not `import type`) of the worker side or the engine.
		const staticImport =
			/^import\s+(?!type\b)[^;]*from\s+"(\.\/(client|worker|host)|@retrospend\/engine[^"]*)"/m;
		for (const file of [
			"controller.ts",
			"instance.ts",
			"load.ts",
			"protocol.ts",
			"react.tsx",
			"rpc.ts",
		])
			expect(read(file), file).not.toMatch(staticImport);
		expect(read("load.ts")).toMatch(
			/if \(process\.env\.NEXT_PUBLIC_DEV_DEVICE_ENGINE === "1"\) \{\s+const \{ spawnDeviceClient \} = await import\("\.\/client"\)/,
		);
	});

	it("keeps the worker's marker out of every file the page loads", () => {
		for (const file of [
			"controller.ts",
			"instance.ts",
			"load.ts",
			"protocol.ts",
			"react.tsx",
			"rpc.ts",
			"client.ts",
		])
			expect(read(file), file).not.toContain("RetrospendDeviceWorker");
		expect(read("worker.ts")).toContain('"RetrospendDeviceWorker"');
	});
});
