import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { HomePage } from "~/features/home/home-page";
import { HomeSkeleton } from "~/features/home/home-states";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyDashboardPage from "./legacy-page";

async function v2On(): Promise<boolean> {
	const session = await getWebSession(await headers());
	return isFlagEnabled("uiV2", session?.user);
}

/** The redesigned page is Home; today's title stays with today's page. */
export async function generateMetadata() {
	if (!(await v2On())) return {};
	const t = await getTranslations("homePage");
	return { title: t("title") };
}

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page() {
	if (!(await v2On())) return <LegacyDashboardPage />;
	return (
		<Suspense fallback={<HomeSkeleton />}>
			<HomePage />
		</Suspense>
	);
}
