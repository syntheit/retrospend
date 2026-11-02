import { requireOptionalNativeModule } from "expo";

interface RetrospendPredictiveBackNative {
	setEnabled(enabled: boolean, backdrop: string | null): void;
	/** Android: lays the sheets out again so their lists can take the drag. */
	refreshSheetScroll(): void;
}

/** The Android module; null on iOS and in tests. */
export const RetrospendPredictiveBack =
	requireOptionalNativeModule<RetrospendPredictiveBackNative>(
		"RetrospendPredictiveBack",
	);
