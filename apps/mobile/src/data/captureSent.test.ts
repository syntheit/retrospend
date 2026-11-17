import type { RetrospendClient } from "@retrospend/api-client";
import { captureSent } from "./captureSent";

const mockEngine = { captureSent: jest.fn() };
jest.mock("./device-engine", () => mockEngine);

// The dev flag decides everything: without EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 the
// engine module is never required, so a release build has nothing to capture
// into (scripts/check-release-bundle.sh looks for the engine's tag).

const api = {} as RetrospendClient;
const entry = { clientId: "e1", entity: "expenses", payload: { amount: "1" } };
afterEach(() => {
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	mockEngine.captureSent.mockReset();
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
});
