import type { Apns } from "./platform";

/** Not iOS: there is no APNs (the real one is apns.ios.ts). */
export const apns: Apns = {
	supported: false,
	permission: async () => "denied",
	requestPermission: async () => "denied",
	setupCategories: async () => undefined,
	deviceToken: async () => null,
	onTokenChange: () => () => undefined,
	onTap: () => () => undefined,
};
