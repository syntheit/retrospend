import { headers } from "next/headers";
import { ProjectPage } from "~/features/project/project-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { db } from "~/server/db";
import { isFlagEnabled } from "~/server/flags";
import { isProjectMember } from "~/server/services/project/page-view";
import LegacyProjectPage from "./legacy-page";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * uiV2 picks the page per viewer; off renders today's page unchanged. The
 * redesigned page is for signed-in members. Guests, viewer links, public
 * pages and invite or resume links keep today's page (they have no uiV2
 * viewer), and so does a signed-in person who is not a member.
 */
export default async function Page({
	params,
	searchParams,
}: {
	params: Params;
	searchParams: Search;
}) {
	const session = await getWebSession(await headers());
	const search = await searchParams;
	const { id } = await params;
	const v2 =
		session?.user.isActive === true &&
		!search.invite &&
		!search.guestResume &&
		(await isFlagEnabled("uiV2", session.user)) &&
		(await isProjectMember(db, id, session.user.id));
	if (!v2) return <LegacyProjectPage params={params} />;
	return <ProjectPage id={id} />;
}
