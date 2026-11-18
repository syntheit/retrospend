import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here: effects run at once and their cleanups are kept, which is all
// the hook uses of React.
const cleanups: (() => void)[] = [];
vi.mock("react", () => ({
	useEffect: (effect: () => (() => void) | undefined) => {
		const cleanup = effect();
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
});
