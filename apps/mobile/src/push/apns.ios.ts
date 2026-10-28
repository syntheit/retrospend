import * as Notifications from "expo-notifications";
import type { Apns, PermissionState } from "./platform";

// iOS and iPadOS push, straight from APNs. expo-notifications is used for
// the native pieces only (permission, the APNs device token, categories,
// tap events). Its Expo push service is never used: no Expo push token is
// requested, and its server auto-registration stays off (it only runs after
// setAutoServerRegistrationEnabledAsync(true), which nothing calls).

function stateOf(
	status: Notifications.NotificationPermissionsStatus,
): PermissionState {
	if (status.granted) return "granted";
	return status.canAskAgain ? "undetermined" : "denied";
}

// While the app is open the system shows nothing by default; a banner and
// sound match what a closed app gets.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: true,
		shouldSetBadge: false,
	}),
});

/** The `retrospend` object the server's payload carries (apns.ts, server). */
function payloadOf(response: Notifications.NotificationResponse): unknown {
	const request = response.notification.request;
	const fromContent = (request.content.data as Record<string, unknown> | null)
		?.retrospend;
	if (fromContent) return fromContent;
	const trigger = request.trigger as { payload?: Record<string, unknown> };
	return trigger?.payload?.retrospend;
}

// The launch tap is delivered once per process, however often a screen
// subscribes again.
let launchTapDelivered = false;

export const apns: Apns = {
	supported: true,
	async permission() {
		return stateOf(await Notifications.getPermissionsAsync());
	},
	async requestPermission() {
		return stateOf(
			await Notifications.requestPermissionsAsync({
				ios: { allowAlert: true, allowSound: true, allowBadge: false },
			}),
		);
	},
	async setupCategories(categories) {
		// The server sets `category` to the channel name and defines no actions
		// yet, so each category is plain; it is registered so the system knows
		// the names and a future action only needs to be added here.
		await Promise.all(
			categories.map((id) =>
				Notifications.setNotificationCategoryAsync(id, []),
			),
		);
	},
	async deviceToken() {
		try {
			const token = await Notifications.getDevicePushTokenAsync();
			return typeof token.data === "string" ? token.data : null;
		} catch {
			// No aps-environment entitlement, or a simulator without APNs.
			return null;
		}
	},
	onTokenChange(listener) {
		const subscription = Notifications.addPushTokenListener((token) => {
			if (typeof token.data === "string") listener(token.data);
		});
		return () => subscription.remove();
	},
	onTap(listener) {
		const subscription = Notifications.addNotificationResponseReceivedListener(
			(response) => listener(payloadOf(response)),
		);
		// The tap that launched the app arrived before any listener existed.
		const launch = launchTapDelivered
			? null
			: Notifications.getLastNotificationResponse();
		if (launch) {
			launchTapDelivered = true;
			listener(payloadOf(launch));
		}
		return () => subscription.remove();
	},
};
