import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FeedbackTable } from "~/components/admin/feedback-table";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { getWebSession } from "~/server/better-auth/web-session";

export default async function FeedbackPage() {
	const session = await getWebSession(await headers());

	if (!session) {
		redirect("/login");
	}

	if ((session.user as { role?: string }).role !== "ADMIN") {
		redirect("/home");
	}

	const t = await getTranslations("admin");

	return (
		<PageFrame>
			<PageHeader title={t("feedbackTitle")} />
			<FeedbackTable />
		</PageFrame>
	);
}
