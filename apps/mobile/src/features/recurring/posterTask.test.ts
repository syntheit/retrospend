import { createMemoryStore } from "@/data/store";

// The background task: armed only on Android and only under the dev flag, on
// the Google-free path the push poll already uses (expo-background-task, which
// is AndroidX WorkManager, and expo-task-manager).

const mockStore = createMemoryStore();
const mockRegister = jest.fn(async () => undefined);
const mockUnregister = jest.fn(async () => undefined);
const mockRegistered = jest.fn(async () => false);
const mockDefine = jest.fn();

jest.mock("expo-background-task", () => ({
	registerTaskAsync: (...args: unknown[]) => mockRegister(...(args as [])),
	unregisterTaskAsync: () => mockUnregister(),
	BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
jest.mock("expo-task-manager", () => ({
	defineTask: (...args: unknown[]) => mockDefine(...args),
	isTaskRegisteredAsync: () => mockRegistered(),
}));
jest.mock("@retrospend/api-client", () => ({
	createRetrospendClient: jest.fn(),
}));
jest.mock("@/auth/restore", () => ({
	ME_CACHE: { name: "me", schema: { parse: (v: unknown) => v } },
}));
jest.mock("@/auth/token-store", () => ({
	createTokenStore: () => ({ get: async () => null }),
}));
jest.mock("@/data/sqlite-store", () => ({
	createSqliteStore: () => mockStore,
}));

import { createEnabledStore } from "@/push/enabled";

// Loaded once: the task is defined when the module loads, before any test clears the mocks.
const android = require("./posterTask.android");
const defined = [...mockDefine.mock.calls];

const who = { baseUrl: "https://s", meId: "me" };
const recorded = () => createEnabledStore(mockStore, "poster.enabled").get();

beforeEach(() => {
	jest.clearAllMocks();
	mockRegistered.mockResolvedValue(false);
});
afterEach(() => {
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
});

describe("on Android", () => {
	const load = () => android;

	it("defines the task when the module loads", () => {
		expect(defined).toEqual([[android.POSTER_TASK, expect.any(Function)]]);
	});

	it("registers every 15 minutes under the flag, and records who it posts for", async () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		const { startPosterTask, POSTER_TASK } = load();
		await startPosterTask(who);
		expect(mockRegister).toHaveBeenCalledWith(POSTER_TASK, {
			minimumInterval: 15,
		});
		expect(await recorded()).toEqual(who);
	});

	it("registers once, however often the app opens", async () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		const { startPosterTask } = load();
		mockRegistered.mockResolvedValue(true);
		await startPosterTask(who);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it("registers nothing and records no one without the flag", async () => {
		const { startPosterTask } = load();
		await startPosterTask({ baseUrl: "https://other", meId: "x" });
		expect(mockRegister).not.toHaveBeenCalled();
		expect((await recorded())?.meId).not.toBe("x");
	});

	it("a task that wakes without the flag does nothing", async () => {
		const task = defined[0]?.[1];
		await createEnabledStore(mockStore, "poster.enabled").set(who);
		expect(await task()).toBe(1);
		// Still recorded, and nothing was forgotten or armed.
		expect(await recorded()).toEqual(who);
		expect(mockUnregister).not.toHaveBeenCalled();
	});
});

describe("not on Android", () => {
	it("arms nothing, with or without the flag", async () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		const { startPosterTask, stopPosterTask } = require("./posterTask");
		await startPosterTask(who);
		await stopPosterTask();
		expect(mockRegister).not.toHaveBeenCalled();
		expect(mockDefine).not.toHaveBeenCalled();
	});
});
