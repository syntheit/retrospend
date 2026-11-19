import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here: a stand-in for useEffect that runs the effect when its
// dependencies changed since the last render and keeps its cleanup, which is
// all the hook uses of React. `rerender` is a render of the same component.
let deps: unknown[] | null = null;
let cleanup: (() => void) | undefined;
const cleanups: (() => void)[] = [];
vi.mock("react", () => ({
	useEffect: (effect: () => (() => void) | undefined, next: unknown[]) => {
		if (
			deps &&
			deps.length === next.length &&
			deps.every((d, i) => Object.is(d, next[i]))
		)
			return;
		cleanup?.();
		deps = next;
		cleanup = effect();
		if (cleanup) cleanups.push(cleanup);
	},
}));
vi.mock("~/hooks/use-session", () => ({ useSession: () => ({ data: null }) }));

const controller = { screenOpened: vi.fn(), screenClosed: vi.fn() };
vi.mock("../instance", () => ({ deviceController: () => controller }));

const { useDeviceCompare } = await import("../react");

beforeEach(() => {
	controller.screenOpened.mockReset();
	controller.screenClosed.mockReset();
	cleanups.length = 0;
	deps = null;
	cleanup = undefined;
});
afterEach(() => vi.unstubAllEnvs());

describe("useDeviceCompare", () => {
	it("opens the screen with its values, and closes it when the page goes", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		useDeviceCompare("budget", { envelopeId: ["e1"] });
		expect(controller.screenOpened).toHaveBeenCalledWith("budget", {
			envelopeId: ["e1"],
		});
		for (const cleanup of cleanups) cleanup();
		expect(controller.screenClosed).toHaveBeenCalledWith("budget");
	});

	it("waits while the page has no values", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		useDeviceCompare("budget", null);
		expect(controller.screenOpened).not.toHaveBeenCalled();
		expect(cleanups).toHaveLength(0);
	});

	it("does nothing without the dev flag", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "");
		useDeviceCompare("wealth", { accountId: ["a1"] });
		expect(controller.screenOpened).not.toHaveBeenCalled();
		expect(cleanups).toHaveLength(0);
	});

	it("a new object with the same ids neither closes nor reopens the screen", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		useDeviceCompare("budget", { envelopeId: ["e1", "e2"] });
		useDeviceCompare("budget", { envelopeId: ["e1", "e2"] });
		expect(controller.screenOpened).toHaveBeenCalledTimes(1);
		expect(controller.screenClosed).not.toHaveBeenCalled();
	});

	it("new ids close and reopen the screen with them", () => {
		vi.stubEnv("NEXT_PUBLIC_DEV_DEVICE_ENGINE", "1");
		useDeviceCompare("budget", { envelopeId: ["e1"] });
		useDeviceCompare("budget", { envelopeId: ["e1", "e2"] });
		expect(controller.screenClosed).toHaveBeenCalledTimes(1);
		expect(controller.screenOpened).toHaveBeenLastCalledWith("budget", {
			envelopeId: ["e1", "e2"],
		});
	});
});
