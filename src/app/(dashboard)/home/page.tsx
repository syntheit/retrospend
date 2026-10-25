import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { HomePage } from "~/features/home/home-page";
import { HomeSkeleton } from "~/features/home/home-states";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

export async function generateMetadata() {
	const t = await getTranslations("homePage");
	return { title: t("title") };
}

/** Home (uiV2). With the flag off, today's dashboard stays the home page. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user))) redirect("/dashboard");
	return (
		<Suspense fallback={<HomeSkeleton />}>
			<HomePage />
		</Suspense>
	);
}
