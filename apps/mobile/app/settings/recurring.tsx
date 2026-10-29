import { Redirect } from "expo-router";

// Recurring expenses are a part of Activity (its second segment). This route
// stays so older links and the Settings row land there.
export default function RecurringSettingsRoute() {
	return (
		<Redirect
			href={{ pathname: "/activity", params: { segment: "recurring" } }}
		/>
	);
}
