import { Redirect } from "expo-router";
import { RECURRING_APART } from "@/layout/destinations";

// Recurring expenses are a part of Activity (its second segment) on phones and
// their own sidebar destination on the iPad. This route stays so older links
// and the Settings row land in the right one.
export default function RecurringSettingsRoute() {
	return RECURRING_APART ? (
		<Redirect href="/recurring" />
	) : (
		<Redirect
			href={{ pathname: "/activity", params: { segment: "recurring" } }}
		/>
	);
}
