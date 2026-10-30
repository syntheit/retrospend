import Constants from "expo-constants";

/**
 * What this build is: the Retrospend release it ships with and the store
 * build number (the commit count; app.config.ts). Shown as "0.5.0 (1847)".
 */
export function appBuild(): { version: string; build: string } {
	const config = Constants.expoConfig;
	const build = Number(config?.extra?.buildNumber);
	return {
		version: config?.version ?? "",
		build: Number.isInteger(build) && build > 0 ? String(build) : "1",
	};
}
