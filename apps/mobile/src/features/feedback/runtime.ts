import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { createSqliteStore } from "@/data/sqlite-store";
import { createErrorLog, type ErrorContext, type ErrorLog } from "./errorLog";

// The one error log of this app, made on first use so importing this file
// touches no storage. The context is read at the moment an error happens.

let screen: string | undefined;

/** The route the person is on, set by the screen tracker. */
export function setCurrentScreen(route: string | undefined): void {
	screen = route;
}

export function currentScreen(): string | undefined {
	return screen;
}

/** The app and phone facts that diagnostics and error reports carry. */
export function appFacts(): Omit<ErrorContext, "screen"> {
	const config = Constants.expoConfig;
	const build =
		Platform.OS === "ios"
			? config?.ios?.buildNumber
			: config?.android?.versionCode?.toString();
	return {
		appVersion: config?.version ?? undefined,
		build: build ?? undefined,
		os: `${Platform.OS === "ios" ? "iOS" : "Android"} ${Platform.Version}`,
		device: Device.modelName ?? undefined,
	};
}

let log: ErrorLog | null = null;

export function getErrorLog(): ErrorLog {
	if (!log)
		log = createErrorLog(createSqliteStore(), () => ({
			...appFacts(),
			screen,
		}));
	return log;
}
