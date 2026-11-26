import { deviceFlagOn } from "./deviceWrites";

// A check that must not be skipped asks the flag, not the engine: the flag is
// set before an engine runs, and a module that fails to load leaves it set.
const ENGINE = "./device-engine";
let flag: string | undefined;

beforeEach(() => {
	flag = process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	jest.resetModules();
});
afterEach(() => {
	if (flag === undefined) delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	else process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = flag;
});

describe("deviceFlagOn", () => {
	it("is off without the flag", () => {
		delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
		expect(deviceFlagOn()).toBe(false);
	});

	it("is on with the flag, whether or not the engine module loads", () => {
		process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
		jest.doMock(ENGINE, () => ({}));
		expect(deviceFlagOn()).toBe(true);
		jest.doMock(ENGINE, () => {
			throw new Error("no sqlcipher");
		});
		jest.resetModules();
		expect(deviceFlagOn()).toBe(true);
	});
});
