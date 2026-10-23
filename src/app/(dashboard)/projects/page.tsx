import { headers } from "next/headers";
import { ProjectsPage } from "~/features/projects/projects-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyProjectsPage from "./legacy-page";

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyProjectsPage />;
	return <ProjectsPage />;
}
