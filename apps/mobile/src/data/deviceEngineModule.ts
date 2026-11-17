import type * as DeviceEngineModule from "./device-engine";

/**
 * The device engine module, or null unless the dev flag
 * EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 is set (a DEV_ variable, so a release build
 * refuses it). It is required only when the flag is set: Metro folds the
 * variable, so every other build leaves the engine and its package out of the
 * bundle (scripts/check-release-bundle.sh). Every dev-only caller goes through
 * here, so there is one gate. The require can throw: callers that must not
 * fail because of it call this inside a try.
 */
export function deviceEngineModule(): typeof DeviceEngineModule | null {
	return process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE === "1"
		? require("./device-engine")
		: null;
}
