"use client";

import { PrivacyContent } from "~/components/legal/privacy-content";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";

export default function SettingsPrivacyPage() {
	return (
		<>
			<SiteHeader
				title={
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="/app/settings">Settings</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>Privacy Policy</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-4xl">
					<PrivacyContent />
				</div>
			</PageContent>
		</>
	);
}
