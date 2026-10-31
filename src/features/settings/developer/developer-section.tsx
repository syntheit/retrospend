"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { API_DOCS_HREF } from "~/features/api-docs/hrefs";
import { useSession } from "~/hooks/use-session";
import { SectionShell } from "../section-shell";
import { SettingRow, SettingRows } from "../setting-row";
import { TokensBlock } from "./tokens-block";
import { WebhooksBlock } from "./webhooks-block";

/**
 * Developer (IMPLEMENTATION §2.3): personal API keys and webhooks on the
 * v1 API, and a link to the API reference. Anything that cannot be undone
 * asks first with a named button. (The devices you are signed in on live in
 * Security.)
 */
export function DeveloperSection() {
	const t = useTranslations("settingsV2.developer");
	const { data: session } = useSession();
	const isAdmin =
		(session?.user as { role?: string } | undefined)?.role === "ADMIN";

	return (
		<SectionShell id="developer" title={t("title")}>
			<TokensBlock isAdmin={isAdmin} />
			<WebhooksBlock />
			<SettingRows className="mt-6" label={t("reference")}>
				<SettingRow label={t("reference")} meta={t("referenceHint")}>
					<Button asChild kind="secondary" size="sm">
						<Link href={API_DOCS_HREF}>{t("openReference")}</Link>
					</Button>
				</SettingRow>
			</SettingRows>
		</SectionShell>
	);
}
