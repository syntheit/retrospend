import { Redirect } from "expo-router";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { IPAD_SIDEBAR } from "@/layout/destinations";

/** iPad: Settings in the sidebar. Elsewhere a link here opens the Settings stack. */
export default function PreferencesTab() {
	if (!IPAD_SIDEBAR) return <Redirect href="/settings" />;
	return <SettingsScreen />;
}
