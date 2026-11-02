import type { LoadingIndicatorProps } from "./types";

/**
 * iOS draws no indicator: its in-flight waits say so in words ("Saving").
 * The Android twin is the Material 3 Expressive loading indicator.
 */
export function LoadingIndicator(_props: LoadingIndicatorProps) {
	return null;
}

/** See the Android twin: the indicator inside another Compose control. */
export function InlineLoadingIndicator(_props: LoadingIndicatorProps) {
	return null;
}
