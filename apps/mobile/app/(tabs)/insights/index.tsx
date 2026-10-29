import { Redirect } from "expo-router";
import { InsightsScreen } from "@/features/insights/InsightsScreen";
import { IPAD_SIDEBAR } from "@/layout/destinations";

/** iPad: the sidebar's Insights. Elsewhere a link here opens Insights over Home. */
export default function InsightsTab() {
	if (!IPAD_SIDEBAR) return <Redirect href="/home/insights" />;
	return <InsightsScreen />;
}
