import { headers } from "next/headers";
import { Suspense } from "react";
import { PeoplePage } from "~/features/people/people-page";
import { PeopleSkeleton } from "~/features/people/people-states";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyPeoplePage from "./legacy-page";

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyPeoplePage />;
	return (
		<Suspense fallback={<PeopleSkeleton />}>
			<PeoplePage />
		</Suspense>
	);
}
