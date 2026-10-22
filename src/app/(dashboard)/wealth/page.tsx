import { headers } from "next/headers";
import { Suspense } from "react";
import { WealthPage } from "~/features/wealth/wealth-page";
import { WealthSkeleton } from "~/features/wealth/wealth-states";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyWealthPage from "./legacy-page";

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyWealthPage />;
	return (
		<Suspense fallback={<WealthSkeleton />}>
			<WealthPage />
		</Suspense>
	);
}
