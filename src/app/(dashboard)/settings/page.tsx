import { headers } from "next/headers";
import { PageContent } from "~/components/page-content";
import { SettingsForm } from "~/components/settings-form";
import { SiteHeader } from "~/components/site-header";
import { SettingsPage } from "~/features/settings/settings-page";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

/**
 * uiV2Mode picks the page per viewer (S4 page rules): on, the redesigned
 * Settings; off, today's page exactly as it was.
 */
export default async function Page() {
	const session = await getWebSession(await headers());
	if (await isFlagEnabled("uiV2", session?.user)) return <SettingsPage />;
	return (
		<>
			<SiteHeader title="Settings" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<SettingsForm />
				</div>
			</PageContent>
		</>
	);
}
