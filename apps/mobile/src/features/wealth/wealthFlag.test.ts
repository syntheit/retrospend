import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { wealthWritesOn } from "./wealthFlag";

// The server's word on account and transfer writes, kept for the next offline start.

const info = (features: Record<string, boolean>) => ({
	platform: { serverInfo: jest.fn(async () => ({ features })) },
});
const down = {
	platform: {
		serverInfo: jest.fn(async () => {
			throw new Error("Network request failed");
		}),
	},
};
const cacheOf = () => createReadCache(createMemoryStore(), "scope");

describe("wealthWritesOn", () => {
	it("is on only when the server says true", async () => {
		expect(
			await wealthWritesOn(info({ wealthWrites: true }) as never, cacheOf()),
		).toBe(true);
		expect(
			await wealthWritesOn(info({ wealthWrites: false }) as never, cacheOf()),
		).toBe(false);
	});

	it("is off for a server that leaves it out (before contract 1.16.0)", async () => {
		expect(
			await wealthWritesOn(info({ autoPost: true }) as never, cacheOf()),
		).toBe(false);
	});

	it("offline, reads what the server said last, and is off when it never said", async () => {
		const cache = cacheOf();
		expect(await wealthWritesOn(down as never, cache)).toBe(false);
		await wealthWritesOn(info({ wealthWrites: true }) as never, cache);
		expect(await wealthWritesOn(down as never, cache)).toBe(true);
		// A server that later says off turns it off, even if it said on before.
		await wealthWritesOn(info({ wealthWrites: false }) as never, cache);
		expect(await wealthWritesOn(down as never, cache)).toBe(false);
	});
});
