import { Redirect } from "expo-router";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { IPAD_SIDEBAR } from "@/layout/destinations";
import { useLayoutClass } from "@/layout/useLayoutClass";

/** iPad: Settings in the sidebar. Elsewhere a link here opens the Settings stack. */
export default function PreferencesTab() {
	const { tablet } = useLayoutClass();
	if (!IPAD_SIDEBAR && !tablet) {
		return <Redirect href="/settings" />;
	}
	return <SettingsScreen panes />;
}
