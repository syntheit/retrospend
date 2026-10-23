"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { SectionShell } from "../section-shell";
import { CreateTokenSheet } from "./create-token-sheet";
import { DeviceRow, KeyRow, TokenBlock, useTokenWords } from "./token-rows";
import { type ApiToken, listTokens, revokeToken } from "./tokens";

const KEYS = ["settings", "apiKeys"] as const;

/**
 * Developer (IMPLEMENTATION §2.3): personal API keys (list, create shown
 * once, revoke) and the devices approved at /device, read by session id
 * from deviceSession (no token reaches the page). Revoking either one
 * cannot be undone, so the menu asks first with a named button.
 */
export function DeveloperSection() {
	const t = useTranslations("settingsV2.developer");
	const words = useTokenWords();
	const toast = useToast();
	const client = useQueryClient();
	const utils = api.useUtils();
	const { data: session } = useSession();
	const keys = useQuery({ queryKey: KEYS, queryFn: listTokens });
	const devices = api.deviceSession.list.useQuery();
	const disconnect = api.deviceSession.disconnect.useMutation();
	const [creating, setCreating] = useState(false);
	const isAdmin =
		(session?.user as { role?: string } | undefined)?.role === "ADMIN";

	const revoke = async (k: ApiToken) => {
		try {
			await revokeToken(k.id);
			toast.saved(t("revoked", { name: k.name }));
		} catch {
			toast.failed(t("failed"));
		}
		await client.invalidateQueries({ queryKey: KEYS });
	};
	const unplug = async (id: string, name: string) => {
		try {
			await disconnect.mutateAsync({ id });
			toast.saved(t("disconnected", { name }));
		} catch {
			toast.failed(t("failed"));
		}
		await utils.deviceSession.list.invalidate();
	};

	const add = (
		<Button kind="secondary" onClick={() => setCreating(true)} size="sm">
			<Plus aria-hidden="true" />
			{t("newKey")}
		</Button>
	);

	return (
		<SectionShell action={add} id="developer" title={t("title")}>
			<TokenBlock
				empty={{ title: t("noKeys"), hint: t("noKeysHint") }}
				first
				state={{
					isLoading: keys.isLoading,
					isError: keys.isError,
					count: keys.data?.length ?? 0,
					retry: () => void keys.refetch(),
				}}
				title={t("keys")}
			>
				{keys.data?.map((k) => (
					<KeyRow
						key={k.id}
						onRevoke={() => void revoke(k)}
						token={k}
					/>
				))}
			</TokenBlock>
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
			<CreateTokenSheet
				isAdmin={isAdmin}
				onCreated={() => client.invalidateQueries({ queryKey: KEYS })}
				onOpenChange={setCreating}
				open={creating}
			/>
		</SectionShell>
	);
}
