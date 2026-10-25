import {
	type PageSearchParams,
	redirectIfUiV2,
} from "~/server/ui-v2-redirect";
import LegacyTransactionsPage from "./legacy-page";

/** uiV2 sends the viewer to Activity (/activity); off renders today's page unchanged. */
export default async function Page({
	searchParams,
}: {
	searchParams: PageSearchParams;
}) {
	await redirectIfUiV2("/activity", searchParams);
	return <LegacyTransactionsPage />;
}
