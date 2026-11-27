import type { RetrospendClient } from "@retrospend/api-client";
import { flush, renderHook, world } from "../../../test/harness";
import type { WealthDevice } from "./deviceWealth";
import type { Account } from "./source";
import { useOpenedAccount, useWealthDevice } from "./useWealthDevice";
import { wealthWritesOn } from "./wealthFlag";

// Both switches must be on for a sheet to queue: the dev flag (an engine runs
// for this client) and the server's wealthWrites. The balance a sheet shows
// and names is the device's, with the screen's own version.
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));

const info = (features: Record<string, boolean>, down = false) =>
	({
		platform: {
			serverInfo: jest.fn(async () => {
				if (down) throw new Error("Network request failed");
				return { features };
			}),
		},
	}) as unknown as RetrospendClient & {
		platform: { serverInfo: jest.Mock };
	};

const engine = { overlayAccount: jest.fn(), storedAccount: jest.fn() };

beforeEach(() => {
	mockWrites.mockReset().mockReturnValue(engine);
	engine.overlayAccount.mockReset().mockResolvedValue(null);
	engine.storedAccount.mockReset().mockResolvedValue(null);
});

describe("useWealthDevice", () => {
	it("is a device only with the dev flag and the server's word", async () => {
		world.api = info({ wealthWrites: true });
		const { result } = await renderHook(() => useWealthDevice(true));
		await flush();
		expect(result.current).toMatchObject({ wealthWrites: true });
		expect(result.current?.outbox).toBe(world.local.outbox);
	});

	it("is null when the server does not say it takes them", async () => {
		world.api = info({ wealthWrites: false });
		const { result } = await renderHook(() => useWealthDevice(true));
		await flush();
		expect(result.current).toBeNull();
	});

	it("is null with the dev flag off, and the server is not even asked", async () => {
		mockWrites.mockReturnValue(null);
		const api = info({ wealthWrites: true });
		world.api = api;
		const { result } = await renderHook(() => useWealthDevice(true));
		await flush();
		expect(result.current).toBeNull();
		expect(api.platform.serverInfo).not.toHaveBeenCalled();
	});

	it("asks nothing while the sheet is closed", async () => {
		const api = info({ wealthWrites: true });
		world.api = api;
		const { result } = await renderHook(() => useWealthDevice(false));
		await flush();
		expect(result.current).toBeNull();
		expect(api.platform.serverInfo).not.toHaveBeenCalled();
	});

	it("offline, reads the server's last word from the cache, and is off when it never said", async () => {
		world.api = info({}, true);
		const never = await renderHook(() => useWealthDevice(true));
		await flush();
		expect(never.result.current).toBeNull();
		never.unmount();

		await wealthWritesOn(info({ wealthWrites: true }), world.local.cache);
		world.api = info({}, true);
		const cached = await renderHook(() => useWealthDevice(true));
		await flush();
		expect(cached.result.current).not.toBeNull();
	});
});

describe("useWealthDevice order and reopening", () => {
	it("a late cache never overrides the server's answer", async () => {
		// The server says off; the cache (which says on) resolves after it.
		await world.local.cache.write("server.wealthWrites", 1, true);
		let release: () => void = () => undefined;
		const cache = world.local.cache;
		const realRead = cache.read.bind(cache);
		jest.spyOn(cache, "read").mockImplementation(
			(...args: Parameters<typeof realRead>) =>
				new Promise((resolve) => {
					release = () => resolve(realRead(...args));
				}) as never,
		);
		world.api = info({ wealthWrites: false });
		const { result } = await renderHook(() => useWealthDevice(true));
		await flush();
		release();
		await flush();
		expect(result.current).toBeNull();
	});

	it("forgets what an earlier opening heard", async () => {
		world.api = info({ wealthWrites: true });
		const { result, rerender } = await renderHook<
			ReturnType<typeof useWealthDevice>,
			boolean
		>((open) => useWealthDevice(open), true);
		await flush();
		expect(result.current).not.toBeNull();
		await rerender(false);
		expect(result.current).toBeNull();
		world.api = info({ wealthWrites: false });
		await rerender(true);
		await flush();
		expect(result.current).toBeNull();
	});
});

const account = {
	id: "a1",
	name: "Galicia",
	type: "CASH",
	balance: { minor: 100_000, currency: "ARS" },
	version: 4,
	updatedAt: "2026-10-12T12:00:00.000Z",
} as unknown as Account;
const deviceOf = () =>
	({ writes: engine, wealthWrites: true }) as unknown as WealthDevice;

describe("useOpenedAccount", () => {
	it("shows the device's balance and names it with the screen's version", async () => {
		engine.storedAccount.mockResolvedValue({
			version: 4,
			balance: "1000.00",
			closed: false,
		});
		engine.overlayAccount.mockResolvedValue({
			version: 99,
			balance: "1200.00000000",
			closed: false,
		});
		const { result } = await renderHook(() =>
			useOpenedAccount(deviceOf(), account, true),
		);
		await flush();
		expect(result.current.shown.balance).toEqual({
			minor: 120_000,
			currency: "ARS",
		});
		expect(result.current.opened).toEqual({
			version: 4,
			balance: "1200.00000000",
		});
	});

	it("is the screen's own when the device cannot read the account", async () => {
		const { result } = await renderHook(() =>
			useOpenedAccount(deviceOf(), account, true),
		);
		await flush();
		expect(result.current.shown).toBe(account);
		expect(result.current.opened).toEqual({ version: 4, balance: "1000.00" });
	});

	it("without a device it asks nothing and is the screen's own", async () => {
		const { result } = await renderHook(() =>
			useOpenedAccount(null, account, true),
		);
		await flush();
		expect(engine.overlayAccount).not.toHaveBeenCalled();
		expect(result.current.shown).toBe(account);
	});

	it("keeps the screen's balance and version when the screen is ahead of what the device pulled", async () => {
		// The list says version 4 and 1,000; the engine pulled version 3 and
		// holds an unsent write over it: its balance belongs to another version.
		engine.storedAccount.mockResolvedValue({
			version: 3,
			balance: "900.00",
			closed: false,
		});
		engine.overlayAccount.mockResolvedValue({
			version: 3,
			balance: "950.00",
			closed: false,
		});
		const { result } = await renderHook(() =>
			useOpenedAccount(deviceOf(), account, true),
		);
		await flush();
		expect(result.current.shown).toBe(account);
		expect(result.current.opened).toEqual({ version: 4, balance: "1000.00" });
	});

	it("a balance that does not read stays the screen's own", async () => {
		engine.storedAccount.mockResolvedValue({
			version: 4,
			balance: "1000.00",
			closed: false,
		});
		engine.overlayAccount.mockResolvedValue({
			version: 1,
			balance: "12.3456789012345",
			closed: false,
		});
		const { result } = await renderHook(() =>
			useOpenedAccount(deviceOf(), account, true),
		);
		await flush();
		expect(result.current.opened).toEqual({ version: 4, balance: "1000.00" });
	});
});
