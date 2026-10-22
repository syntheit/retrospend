import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FeedbackTable } from "~/components/admin/feedback-table";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { getWebSession } from "~/server/better-auth/web-session";

export default async function FeedbackPage() {
	const session = await getWebSession(await headers());

	if (!session) {
		redirect("/login");
	}

	if ((session.user as { role?: string }).role !== "ADMIN") {
		redirect("/dashboard");
	}

	return (
		<>
			<SiteHeader title="Feedback" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl">
					<FeedbackTable />
				</div>
			</PageContent>
		</>
	);
}
