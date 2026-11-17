import { fakeDeviceApi } from "../../test/deviceApi";
import { createDeviceEngine, engineFor } from "./device-engine";

describe("engineFor", () => {
	it("keeps one engine per client and account", () => {
		const { client } = fakeDeviceApi();
		const mine = engineFor(client, "u1");
		expect(engineFor(client, "u1")).toBe(mine);
		expect(engineFor(client, "u2")).not.toBe(mine);
		expect(engineFor(fakeDeviceApi().client, "u1")).not.toBe(mine);
	});
});

describe("createDeviceEngine on the phone", () => {
	it("logs the core's warnings with the engine tag", async () => {
		const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const { api } = fakeDeviceApi({
				fail: { route: "expenses", pull: 1, error: new Error("offline") },
			});
			await createDeviceEngine(api, "u1", () => 0, { warn: undefined }).pull();
			expect(spy).toHaveBeenCalledWith(
				"RetrospendDeviceEngine: pull failed",
				"Error",
			);
		} finally {
			spy.mockRestore();
		}
	});
});
