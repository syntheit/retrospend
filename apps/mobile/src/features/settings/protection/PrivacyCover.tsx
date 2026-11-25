import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useTheme } from "@/theme";

/** Out of front: another app, the switcher or the lock screen is up. An unknown state is not a reason to cover. */
const away = (state: string | null | undefined) =>
	state === "inactive" || state === "background";

/** Whether the app is in front. */
export function useAppActive(): boolean {
	const [active, setActive] = useState(!away(AppState.currentState));
	useEffect(() => {
		const sub = AppState.addEventListener("change", (state) =>
			setActive(!away(state)),
		);
		return () => sub.remove();
	}, []);
	return active;
}

/**
 * The cover for what a sheet shows when the app leaves the front: the recovery
 * key, the typed groups and the passwords. The app switcher takes its picture
 * while the app is inactive, so the sheet's body is hidden under a plain
 * surface then and back again on return. Nothing is wiped (people go to their
 * email for a code and to Files to save the key): only the picture is covered.
 * Drawn as the last child of the sheet's body, so it fills it. One owner for
 * the recovery, Make new key and enable sheets.
 */
export function PrivacyCover() {
	const active = useAppActive();
	const { color } = useTheme();
	if (active) return null;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			pointerEvents="none"
			style={{
				position: "absolute",
				top: 0,
				right: 0,
				bottom: 0,
				left: 0,
				backgroundColor: color.surface,
			}}
			testID="privacy-cover"
		/>
	);
}
