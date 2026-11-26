import { AppState, type AppStateStatus } from "react-native";
import { fakeDeviceApi } from "../../test/deviceApi";
import { act, renderHook, world } from "../../test/harness";
import { useDevicePull, useDeviceReads } from "./useDeviceEngine";

const mockRunPoster = jest.fn(async (_input: unknown) => ({ status: "off" }));
const mockStartPosterTask = jest.fn(async (_who: unknown) => undefined);
jest.mock("@/features/recurring/poster", () => ({
	runPoster: (input: unknown) => mockRunPoster(input),
}));
jest.mock("@/features/recurring/posterTask", () => ({
	startPosterTask: (who: unknown) => mockStartPosterTask(who),
}));

// The dev flag decides everything: without EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 the
// hooks do nothing and ask the server for nothing. With it, a pull runs when
// someone signs in, again when the app returns after a minute, and never
// offline. The recurring poster runs once after each pull settles, and the
// Android task is armed for the signed-in account; neither exists without the flag.

let handlers: ((state: AppStateStatus) => void)[];
let removed: jest.Mock;
beforeEach(() => {
	mockRunPoster.mockClear();
	mockStartPosterTask.mockClear();
	handlers = [];
	removed = jest.fn();
	jest
		.spyOn(AppState, "addEventListener")
		.mockImplementation((_type, handler) => {
			handlers.push(handler as (state: AppStateStatus) => void);
			return { remove: removed };
		});
	jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	jest.restoreAllMocks();
	jest.useRealTimers();
});

const settled = () => act(async () => {});

describe("without the flag", () => {
	it("gives Home nothing to read from and pulls nothing", async () => {
		const { client, calls } = fakeDeviceApi();
		world.api = client;
		const { result } = await renderHook(() => {
			useDevicePull();
			return useDeviceReads();
		});
		await settled();
		expect(result.current).toBeNull();
		expect(calls).toEqual([]);
		expect(handlers).toEqual([]);
		expect(mockRunPoster).not.toHaveBeenCalled();
		expect(mockStartPosterTask).not.toHaveBeenCalled();
	});
});

describe("with the flag", () => {
	beforeEach(() => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
	});

	it("pulls when someone signs in and offers Home the engine to read from", async () => {
		const { client, calls } = fakeDeviceApi();
		world.api = client;
		const { result } = await renderHook(() => {
			useDevicePull();
			return useDeviceReads();
		});
		await settled();
		expect(calls[0]).toBe("settings");
		expect(calls.at(-1)).toBe("dailyRates");
		expect(result.current).not.toBeNull();
	});

	it("runs the poster once the pull has settled, on the session's client and outbox, and arms the task", async () => {
		const { client, calls } = fakeDeviceApi();
		world.api = client;
		await renderHook(() => useDevicePull());
		await settled();
		expect(calls.at(-1)).toBe("dailyRates");
		expect(mockRunPoster).toHaveBeenCalledTimes(1);
		expect(mockRunPoster).toHaveBeenCalledWith(
			expect.objectContaining({ api: client, outbox: world.local.outbox }),
		);
		expect(mockStartPosterTask).toHaveBeenCalledWith({
			baseUrl: "https://example.test",
			meId: "me1",
		});
	});

	it("runs the poster when the app returns to the foreground, after the pull it asks for", async () => {
		jest.useFakeTimers({ now: new Date("2026-10-15T15:00:00.000Z") });
		const { client } = fakeDeviceApi();
		world.api = client;
		await renderHook(() => useDevicePull());
		await settled();
		expect(mockRunPoster).toHaveBeenCalledTimes(1);
		jest.setSystemTime(new Date("2026-10-15T15:02:00.000Z"));
		await act(async () => handlers[0]?.("active"));
		expect(mockRunPoster).toHaveBeenCalledTimes(2);
	});

	it("does nothing without a server or offline", async () => {
		world.api = undefined;
		await renderHook(() => useDevicePull());
		const { client, calls } = fakeDeviceApi();
		world.api = client;
		world.reachable = false;
		await renderHook(() => useDevicePull());
		await settled();
		expect(calls).toEqual([]);
		expect(mockRunPoster).not.toHaveBeenCalled();
	});

	it("pulls again on the foreground only after a minute, and stops listening on unmount", async () => {
		jest.useFakeTimers({ now: new Date("2026-10-15T15:00:00.000Z") });
		const { client, pulls } = fakeDeviceApi();
		world.api = client;
		const hook = await renderHook(() => useDevicePull());
		await settled();
		expect(pulls()).toBe(1);

		jest.setSystemTime(new Date("2026-10-15T15:00:59.000Z"));
		await act(async () => handlers[0]?.("active"));
		expect(pulls()).toBe(1);

		jest.setSystemTime(new Date("2026-10-15T15:01:00.000Z"));
		await act(async () => handlers[0]?.("background"));
		expect(pulls()).toBe(1);
		await act(async () => handlers[0]?.("active"));
		expect(pulls()).toBe(2);

		await hook.unmount();
		expect(removed).toHaveBeenCalled();
	});
});
