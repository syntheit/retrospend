import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyDashboardPage from "./legacy-page";

/** uiV2 sends the viewer to Home (/home); off renders today's page unchanged. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (await isFlagEnabled("uiV2", session?.user)) redirect("/home");
	return <LegacyDashboardPage />;
}
