import { requireOptionalNativeModule } from "expo";

interface RetrospendNotifyNative {
	ensureChannels(
		channels: { id: string; name: string; description: string }[],
	): void;
	enabled(): boolean;
	post(notification: Record<string, string>): void;
}

/** The Android module; null on iOS and in tests. */
export const RetrospendNotify =
	requireOptionalNativeModule<RetrospendNotifyNative>("RetrospendNotify");
