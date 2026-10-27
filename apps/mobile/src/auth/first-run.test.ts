import { createMemoryStore } from "@/data/store";
import {
	clearStaleServerOnFirstRun,
	clearStaleTokenOnFirstRun,
} from "./first-run";

describe("clearStaleTokenOnFirstRun", () => {
	it("drops a token that outlived a reinstall, once", async () => {
		const store = createMemoryStore();
		let cleared = 0;
		const tokens = {
			clear: async () => {
				cleared++;
			},
		};
		expect(await clearStaleTokenOnFirstRun(store, tokens)).toBe(true);
		expect(cleared).toBe(1);
		expect(await clearStaleTokenOnFirstRun(store, tokens)).toBe(false);
		expect(cleared).toBe(1);
	});
});

describe("clearStaleServerOnFirstRun", () => {
	it("forgets a server that outlived a reinstall", async () => {
		const store = createMemoryStore();
		let cleared = 0;
		const clear = async () => {
			cleared++;
		};
		expect(await clearStaleServerOnFirstRun(store, clear)).toBe(true);
		expect(cleared).toBe(1);
	});

	it("keeps the server once the first run is marked", async () => {
		const store = createMemoryStore();
		await clearStaleTokenOnFirstRun(store, { clear: async () => {} });
		let cleared = 0;
		const clear = async () => {
			cleared++;
		};
		expect(await clearStaleServerOnFirstRun(store, clear)).toBe(false);
		expect(cleared).toBe(0);
	});
});
