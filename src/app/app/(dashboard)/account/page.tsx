"use client";

import { AccountForm } from "~/components/account-form";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";

export default function Page() {
	return (
		<>
			<SiteHeader title="Account" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl space-y-6">
					<AccountForm />
				</div>
			</PageContent>
		</>
	);
}
