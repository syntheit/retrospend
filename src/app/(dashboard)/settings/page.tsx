"use client";

import { PageContent } from "~/components/page-content";
import { SettingsForm } from "~/components/settings-form";
import { SiteHeader } from "~/components/site-header";

export default function Page() {
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
