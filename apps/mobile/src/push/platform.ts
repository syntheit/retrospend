// The two platform halves of push, behind one shape each. The real iOS half
// (apns.ios.ts) imports expo-notifications, which is linked on iOS only: its
// Android half is Firebase Cloud Messaging. The real Android half
// (local.android.ts) is a small native module with no Google services. Metro
// picks the file by platform; the plain files (apns.ts, local.ts) are the
// other platform's stub, so a bundle never imports a library its platform
// does not have.

export type PermissionState = "granted" | "denied" | "undetermined";

export interface Apns {
	/** False off iOS: nothing below does anything. */
	supported: boolean;
	permission(): Promise<PermissionState>;
	/** Shows the system prompt the first time; later calls just report. */
	requestPermission(): Promise<PermissionState>;
	/** Registers the notification categories the server's payloads name. */
	setupCategories(categories: string[]): Promise<void>;
	/** The native APNs device token (hex), or null when the system gives none. */
	deviceToken(): Promise<string | null>;
	/** Called when the system hands the app a new token. */
	onTokenChange(listener: (token: string) => void): () => void;
	/**
	 * Called with the `retrospend` object of a tapped notification; also once
	 * for the tap that launched the app.
	 */
	onTap(listener: (payload: unknown) => void): () => void;
}

export interface LocalChannel {
	id: string;
	name: string;
	description: string;
}

export interface LocalPost {
	key: string;
	channel: string;
	title: string;
	body: string;
	/** Opened by a tap: a retrospend:// link. */
	url: string;
}

export interface Local {
	supported: boolean;
	ensureChannels(channels: LocalChannel[]): void;
	/** True when notifications are allowed for the app. */
	enabled(): boolean;
	/** Shows the system prompt on Android 13 and up. */
	requestPermission(): Promise<boolean>;
	post(notification: LocalPost): void;
}
