import type { RetrospendClient } from "@retrospend/api-client";
import { captureSent, dropCaptured } from "./captureSent";

const mockEngine = {
	captureSent: jest.fn(),
	dropCaptured: jest.fn(),
	initThrows: false,
};
jest.mock("./device-engine", () => {
	if (mockEngine.initThrows) throw new Error("init failed");
	return mockEngine;
});

// The dev flag decides everything: without EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 the
// engine module is never required, so a release build has nothing to capture
// into (scripts/check-release-bundle.sh looks for the engine's tag). Nothing
// here may throw into a write, not even a module that fails to load.

const api = {} as RetrospendClient;
const entry = { clientId: "e1", entity: "expenses", payload: { amount: "1" } };
beforeEach(() => {
	jest.resetModules();
});
afterEach(() => {
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	mockEngine.captureSent.mockReset();
	mockEngine.dropCaptured.mockReset();
	mockEngine.initThrows = false;
});

describe("captureSent", () => {
	it("does nothing without the flag", () => {
		captureSent(api, entry, 5);
		expect(mockEngine.captureSent).not.toHaveBeenCalled();
	});

	it("hands the engine module the entry and the start of the send with the flag", () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		captureSent(api, entry, 5);
		expect(mockEngine.captureSent).toHaveBeenCalledWith(api, entry, 5);
	});

	it("never throws into a send", () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		mockEngine.captureSent.mockImplementation(() => {
			throw new Error("boom");
		});
		expect(() => captureSent(api, entry, 5)).not.toThrow();
	});

	it("never throws into a send when the engine module fails to load", () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		mockEngine.initThrows = true;
		expect(() => captureSent(api, entry, 5)).not.toThrow();
		expect(() => dropCaptured(api, "e1")).not.toThrow();
	});
});

describe("dropCaptured", () => {
	it("does nothing without the flag", () => {
		dropCaptured(api, "e1");
		expect(mockEngine.dropCaptured).not.toHaveBeenCalled();
	});

	it("hands the engine module the id with the flag, and never throws", () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		dropCaptured(api, "e1");
		expect(mockEngine.dropCaptured).toHaveBeenCalledWith(api, "e1");
		mockEngine.dropCaptured.mockImplementation(() => {
			throw new Error("boom");
		});
		expect(() => dropCaptured(api, "e1")).not.toThrow();
	});
});
