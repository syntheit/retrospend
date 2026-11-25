import { cipherFake } from "../../test/cipherFake";
import { fakeDeviceApi } from "../../test/deviceApi";
import { removeDir, tempDir } from "../../test/nodeSqlite";
import { createDeviceEngine, engineFor, writesFor } from "./device-engine";
import { sweepEngineDbs } from "./engine-db/sweep";

describe("engineFor", () => {
	it("keeps one engine per client and account", () => {
		const { client } = fakeDeviceApi();
		const mine = engineFor(client, "u1");
		expect(engineFor(client, "u1")).toBe(mine);
		expect(engineFor(client, "u2")).not.toBe(mine);
		expect(engineFor(fakeDeviceApi().client, "u1")).not.toBe(mine);
	});
});

describe("writesFor", () => {
	it("is null until the client has an engine, then reads the engine's pulls begun", async () => {
		const { client } = fakeDeviceApi();
		expect(writesFor(client)).toBeNull();
		const engine = engineFor(client, "u1");
		const writes = writesFor(client);
		expect(writes?.pullsBegun()).toBe(0);
		await engine.pull();
		expect(writes?.pullsBegun()).toBe(1);
	});

	it("is null once the engine is disposed", async () => {
		const { client } = fakeDeviceApi();
		const engine = engineFor(client, "u1");
		await engine.dispose({ wipe: true });
		expect(writesFor(client)).toBeNull();
	});
});

describe("sign-out", () => {
	it("disposes the engine when the sweep runs after a sign-out", async () => {
		const dir = tempDir();
		try {
			const phone = cipherFake(dir);
			const { client } = fakeDeviceApi();
			const engine = engineFor(
				client,
				"u1",
				"https://money.example.test",
				phone.deps,
			);
			await engine.pull();
			await sweepEngineDbs(null, phone.deps);
			expect(engine.disposed).toBe(true);
		} finally {
			removeDir(dir);
		}
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
