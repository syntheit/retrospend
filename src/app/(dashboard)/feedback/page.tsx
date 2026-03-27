import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FeedbackTable } from "~/components/admin/feedback-table";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { auth } from "~/server/better-auth";

export default async function FeedbackPage() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

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
