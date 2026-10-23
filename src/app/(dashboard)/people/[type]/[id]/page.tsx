import { headers } from "next/headers";
import { Suspense } from "react";
import { PeopleSkeleton } from "~/features/people/people-states";
import { PersonPage } from "~/features/person/person-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyPersonPage from "./legacy-page";

type Params = Promise<{ type: string; id: string }>;

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page({ params }: { params: Params }) {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyPersonPage params={params} />;
	const { type, id } = await params;
	return (
		<Suspense fallback={<PeopleSkeleton />}>
			<PersonPage id={decodeURIComponent(id)} type={type} />
		</Suspense>
	);
}
