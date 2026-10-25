import {
	type PageSearchParams,
	redirectIfUiV2,
} from "~/server/ui-v2-redirect";
import LegacyDashboardPage from "./legacy-page";

/** uiV2 sends the viewer to Home (/home); off renders today's page unchanged. */
export default async function Page({
	searchParams,
}: {
	searchParams: PageSearchParams;
}) {
	await redirectIfUiV2("/home", searchParams);
	return <LegacyDashboardPage />;
}
