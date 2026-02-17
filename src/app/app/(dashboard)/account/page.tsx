"use client";

import { PageContent } from "~/components/page-content";
import { ProfileDashboard } from "~/components/profile-dashboard";
import { SiteHeader } from "~/components/site-header";

export default function Page() {
	return (
		<>
			<SiteHeader title="Account" />
			<PageContent>
				<ProfileDashboard />
			</PageContent>
		</>
	);
}
