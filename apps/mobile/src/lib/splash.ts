import { SplashScreen } from "expo-router";

// The native splash stays up until the first real screen is ready. Without
// this the router hides it as soon as the root layout mounts, which shows a
// blank window while fonts load and the saved session is read.

/** The splash never outlives this, whatever the session or fonts are doing. */
export const SPLASH_CAP_MS = 6000;

/** Call once at startup, before the first render. */
export function holdSplash(): void {
	SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

export function releaseSplash(): void {
	SplashScreen.hideAsync().catch(() => undefined);
}
