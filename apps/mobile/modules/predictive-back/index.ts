import { requireOptionalNativeModule } from "expo";

interface RetrospendPredictiveBackNative {
	setEnabled(enabled: boolean): void;
}

/** The Android module; null on iOS and in tests. */
export const RetrospendPredictiveBack =
	requireOptionalNativeModule<RetrospendPredictiveBackNative>(
		"RetrospendPredictiveBack",
	);
