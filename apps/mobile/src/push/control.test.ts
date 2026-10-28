import { createMemoryStore } from "@/data/store";

jest.mock("./apns", () => ({
	apns: {
		supported: true,
		permission: jest.fn(),
		requestPermission: jest.fn(),
		setupCategories: jest.fn(async () => undefined),
		deviceToken: jest.fn(),
		onTokenChange: jest.fn(),
		onTap: jest.fn(),
	},
}));
jest.mock("./local", () => ({ local: { supported: false } }));
jest.mock("./background", () => ({
	startPolling: async () => undefined,
	stopPolling: async () => undefined,
}));
jest.mock("./texts", () => ({
	channelDefs: () => [],
	makeTranslator: () => null,
}));

import { apns } from "./apns";
import { createPushControl } from "./control";
import { createEnabledStore } from "./enabled";

const mockApns = apns as unknown as {
	permission: jest.Mock;
	requestPermission: jest.Mock;
	deviceToken: jest.Mock;
};
const TOKEN = "ab".repeat(32);

function setup(sandbox = false) {
	const store = createMemoryStore();
	const register = jest.fn(async (_input: unknown) => ({ id: "d1" }));
	const remove = jest.fn(async (_input: unknown) => ({ ok: true }));
	const control = createPushControl({
		store,
		api: { push: { register, remove } } as never,
		who: { baseUrl: "https://s", meId: "me" },
		sandbox,
	});
	return {
		store,
		register,
		remove,
		control,
		enabled: createEnabledStore(store),
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	mockApns.permission.mockResolvedValue("granted");
});

describe("push control on iOS", () => {
	it("asks for permission first and registers nothing when it is refused", async () => {
		mockApns.requestPermission.mockResolvedValue("denied");
		const { control, register, enabled } = setup();
		expect(await control.enable()).toBe("denied");
		expect(mockApns.deviceToken).not.toHaveBeenCalled();
		expect(register).not.toHaveBeenCalled();
		expect(await enabled.get()).toBeNull();
	});

	it("registers the token and turns the switch on", async () => {
		mockApns.requestPermission.mockResolvedValue("granted");
		mockApns.deviceToken.mockResolvedValue(TOKEN);
		const { control, register, enabled } = setup(true);
		expect(await control.enable()).toBe("on");
		expect(register).toHaveBeenCalledWith(
			expect.objectContaining({ token: TOKEN, apnsSandbox: true }),
		);
		expect(await enabled.get()).toEqual({ baseUrl: "https://s", meId: "me" });
	});

	it("stays off when the system gives no token", async () => {
		mockApns.requestPermission.mockResolvedValue("granted");
		mockApns.deviceToken.mockResolvedValue(null);
		const { control, enabled } = setup();
		expect(await control.enable()).toBe("unavailable");
		expect(await enabled.get()).toBeNull();
	});

	it("registers again at start only while Push is on", async () => {
		mockApns.deviceToken.mockResolvedValue(TOKEN);
		const { control, register, enabled } = setup();
		await control.refresh();
		expect(register).not.toHaveBeenCalled();
		await enabled.set({ baseUrl: "https://s", meId: "me" });
		await control.refresh();
		expect(register).toHaveBeenCalledTimes(1);
	});

	it("does not register a new token while Push is off", async () => {
		const { control, register } = setup();
		await control.registerToken(TOKEN);
		expect(register).not.toHaveBeenCalled();
	});

	it("removes the device and the switch when turned off", async () => {
		mockApns.requestPermission.mockResolvedValue("granted");
		mockApns.deviceToken.mockResolvedValue(TOKEN);
		const { control, remove, enabled } = setup();
		await control.enable();
		await control.disable();
		expect(remove).toHaveBeenCalledWith({ id: "d1" });
		expect(await enabled.get()).toBeNull();
	});
});
