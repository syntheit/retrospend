import { createMemoryStore } from "@/data/store";
import { clearStaleTokenOnFirstRun } from "./first-run";

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
