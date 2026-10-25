"use client";

import { useTranslations } from "next-intl";
import { BackButton, PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { TermsContent } from "~/components/legal/terms-content";

export default function SettingsTermsPage() {
	const t = useTranslations("settingsV2");
	return (
		<PageFrame>
			<PageHeader
				lead={<BackButton href="/settings" label={t("title")} />}
				title={t("title")}
			/>
			<TermsContent />
		</PageFrame>
	);
}
