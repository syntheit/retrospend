import { headers } from "next/headers";
import { Suspense } from "react";
import { ImportPage } from "~/features/import/import-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";
import LegacyImportPage from "./legacy-page";

/** uiV2 picks the page per viewer; off renders today's page unchanged. */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (!(await isFlagEnabled("uiV2", session?.user)))
		return <LegacyImportPage />;
	// ?job= opens that file's review (a link from Recent imports or Needs you).
	return (
		<Suspense>
			<ImportPage />
		</Suspense>
	);
}
