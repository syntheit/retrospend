"use client";

import { TermsContent } from "~/components/legal/terms-content";
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

export default function SettingsTermsPage() {
	return (
		<>
			<SiteHeader
				title={
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>Terms and Conditions</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				}
			/>
			<PageContent>
				<div className="mx-auto w-full max-w-4xl">
					<TermsContent />
				</div>
			</PageContent>
		</>
	);
}
