"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { API_DOCS_HREF } from "~/features/api-docs/hrefs";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { SettingRow, SettingRows } from "../setting-row";
import { SectionShell } from "../section-shell";
import { DeviceRow, TokenBlock, useTokenWords } from "./token-rows";
import { TokensBlock } from "./tokens-block";
import { WebhooksBlock } from "./webhooks-block";

/**
 * Developer (IMPLEMENTATION §2.3): personal API keys and webhooks on the
 * v1 API, the devices approved at /device (read by session id from
 * deviceSession; no token reaches the page) and a link to the API
 * reference. Anything that cannot be undone asks first with a named button.
 */
export function DeveloperSection() {
	const t = useTranslations("settingsV2.developer");
	const words = useTokenWords();
	const toast = useToast();
	const utils = api.useUtils();
	const { data: session } = useSession();
	const devices = api.deviceSession.list.useQuery();
	const disconnect = api.deviceSession.disconnect.useMutation();
	const isAdmin =
		(session?.user as { role?: string } | undefined)?.role === "ADMIN";

	const unplug = async (id: string, name: string) => {
		try {
			await disconnect.mutateAsync({ id });
			toast.saved(t("disconnected", { name }));
		} catch {
			toast.failed(t("failed"));
		}
		await utils.deviceSession.list.invalidate();
	};

	return (
		<SectionShell id="developer" title={t("title")}>
			<TokensBlock isAdmin={isAdmin} />
			<WebhooksBlock />
			<TokenBlock
				empty={{ title: t("noDevices"), hint: t("noDevicesHint") }}
				state={{
					isLoading: devices.isLoading,
					isError: devices.isError,
					count: devices.data?.length ?? 0,
					retry: () => void devices.refetch(),
				}}
				title={t("devices")}
			>
				{devices.data?.map((d) => (
					<DeviceRow
						device={d}
						key={d.id}
						onDisconnect={() => void unplug(d.id, words.client(d.clientId))}
					/>
				))}
			</TokenBlock>
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
