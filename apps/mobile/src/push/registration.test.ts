import { createMemoryStore } from "@/data/store";
import {
	createRegistrationStore,
	syncRegistration,
	unregister,
} from "./registration";

const TOKEN = "ab".repeat(32);

function fakeApi(ids: string[]) {
	const register = jest.fn(async (_input: unknown) => ({
		id: ids.shift() ?? "d9",
	}));
	const remove = jest.fn(async (_input: { id: string }) => ({
		ok: true as const,
	}));
	return { api: { register, remove } as never, register, remove };
}

describe("device registration", () => {
	it("registers the APNs token with the sandbox flag and remembers the device", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, register } = fakeApi(["d1"]);
		const done = await syncRegistration({
			api,
			store,
			token: TOKEN,
			sandbox: true,
			device: { appVersion: "0.1.0", deviceName: "iPad" },
		});
		expect(register).toHaveBeenCalledWith({
			transport: "apns",
			platform: "ios",
			token: TOKEN,
			apnsSandbox: true,
			appVersion: "0.1.0",
			deviceName: "iPad",
		});
		expect(done).toEqual({ deviceId: "d1", token: TOKEN, sandbox: true });
		expect(await store.get()).toEqual(done);
	});

	it("sends a production token without the sandbox flag set", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, register } = fakeApi(["d1"]);
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({ apnsSandbox: false }),
		);
	});

	it("registers again on every start, and keeps one device when the address is unchanged", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, register, remove } = fakeApi(["d1", "d1"]);
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		expect(register).toHaveBeenCalledTimes(2);
		expect(remove).not.toHaveBeenCalled();
	});

	it("removes the old device row when the token changes", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, remove } = fakeApi(["d1", "d2"]);
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		await syncRegistration({
			api,
			store,
			token: "cd".repeat(32),
			sandbox: false,
		});
		expect(remove).toHaveBeenCalledWith({ id: "d1" });
		expect((await store.get())?.deviceId).toBe("d2");
	});

	it("keeps the new registration when removing the old one fails", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, remove } = fakeApi(["d1", "d2"]);
		remove.mockRejectedValue(new Error("offline"));
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		await expect(
			syncRegistration({ api, store, token: "cd".repeat(32), sandbox: false }),
		).resolves.toMatchObject({ deviceId: "d2" });
	});

	it("unregisters on sign-out, even offline", async () => {
		const store = createRegistrationStore(createMemoryStore(), "s|u");
		const { api, remove } = fakeApi(["d1"]);
		await syncRegistration({ api, store, token: TOKEN, sandbox: false });
		remove.mockRejectedValue(new Error("offline"));
		await unregister({ api, store });
		expect(remove).toHaveBeenCalledWith({ id: "d1" });
		expect(await store.get()).toBeNull();
	});

	it("keeps accounts apart", async () => {
		const backing = createMemoryStore();
		const a = createRegistrationStore(backing, "s|a");
		const b = createRegistrationStore(backing, "s|b");
		const { api } = fakeApi(["d1"]);
		await syncRegistration({ api, store: a, token: TOKEN, sandbox: false });
		expect(await b.get()).toBeNull();
	});
});
