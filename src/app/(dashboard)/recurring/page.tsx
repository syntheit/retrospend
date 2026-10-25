import {
	type PageSearchParams,
	redirectIfUiV2,
} from "~/server/ui-v2-redirect";
import LegacyRecurringPage from "./legacy-page";

/** uiV2 sends the viewer to Activity's Recurring tab; off renders today's page unchanged. */
export default async function Page({
	searchParams,
}: {
	searchParams: PageSearchParams;
}) {
	await redirectIfUiV2("/activity/recurring", searchParams);
	return <LegacyRecurringPage />;
}
