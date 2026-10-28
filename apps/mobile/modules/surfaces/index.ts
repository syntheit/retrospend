import { requireOptionalNativeModule } from "expo";

interface RetrospendSurfacesNative {
	/**
	 * The share or Shortcut waiting for the app, as JSON (src/surfaces/prefill.ts
	 * reads it), once; null when there is none. iOS reads the App Group,
	 * Android reads the activity's SEND intent.
	 */
	consumePending(): string | null;
	/** Android only: a share arrived while the app was running. */
	addListener(
		event: "onPending",
		listener: () => void,
	): { remove(): void };
}

/** The native hand-off; null in tests and where the module is not built in. */
export const RetrospendSurfaces =
	requireOptionalNativeModule<RetrospendSurfacesNative>("RetrospendSurfaces");
