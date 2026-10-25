import { headers } from "next/headers";
import { ProjectPage } from "~/features/project/project-page";
import { SharedProjectPage } from "~/features/project/shared/shared-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { db } from "~/server/db";
import { isProjectMember } from "~/server/services/project/page-view";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * A signed-in member gets the project page. Everyone else (a guest, a viewer
 * link, an invite or resume link, the public, a signed-in person who is not
 * in the project) gets the shared page, which reads with the tokens in their
 * browser.
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
	const member =
		session?.user.isActive === true &&
		!search.invite &&
		!search.guestResume &&
		(await isProjectMember(db, id, session.user.id));
	return member ? <ProjectPage id={id} /> : <SharedProjectPage id={id} />;
}
