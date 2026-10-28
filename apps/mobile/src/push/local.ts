import type { Local } from "./platform";

/** Not Android: iOS notifications come from APNs (the real one is local.android.ts). */
export const local: Local = {
	supported: false,
	ensureChannels: () => undefined,
	enabled: () => false,
	requestPermission: async () => false,
	post: () => undefined,
};
