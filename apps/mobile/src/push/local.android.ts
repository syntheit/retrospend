import { PermissionsAndroid, Platform } from "react-native";
import { RetrospendNotify } from "../../modules/notify";
import type { Local } from "./platform";

/** Android: local notifications through the app's own native module. */
export const local: Local = {
	supported: RetrospendNotify !== null,
	ensureChannels: (channels) => RetrospendNotify?.ensureChannels(channels),
	enabled: () => RetrospendNotify?.enabled() ?? false,
	async requestPermission() {
		// Below Android 13 notifications need no runtime permission.
		if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
			const answer = await PermissionsAndroid.request(
				"android.permission.POST_NOTIFICATIONS",
			);
			if (answer !== PermissionsAndroid.RESULTS.GRANTED) return false;
		}
		return RetrospendNotify?.enabled() ?? false;
	},
	post: (notification) => RetrospendNotify?.post({ ...notification }),
};
