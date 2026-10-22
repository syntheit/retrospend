"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { useToast } from "~/components/ui/toast";
import { useSession } from "~/hooks/use-session";
import { SectionShell } from "../section-shell";
import { CreateTokenSheet } from "./create-token-sheet";
import { DeviceRow, KeyRow, TokenBlock, useTokenWords } from "./token-rows";
import {
	type ApiToken,
	type ApprovedDevice,
	disconnectDevice,
	listDevices,
	listTokens,
	revokeToken,
} from "./tokens";

const KEYS = ["settings", "apiKeys"] as const;
const DEVICES = ["settings", "devices"] as const;

type Pending =
	| { kind: "key"; token: ApiToken }
	| { kind: "device"; device: ApprovedDevice }
	| null;

/**
 * Developer (IMPLEMENTATION §2.3): personal API keys (list, create shown
 * once, revoke) and the devices approved at /device. Revoking either one
 * cannot be undone, so both ask first with a named button.
 */
export function DeveloperSection() {
	const t = useTranslations("settingsV2.developer");
	const words = useTokenWords();
	const toast = useToast();
	const client = useQueryClient();
	const { data: session } = useSession();
	const keys = useQuery({ queryKey: KEYS, queryFn: listTokens });
	const devices = useQuery({ queryKey: DEVICES, queryFn: listDevices });
	const [creating, setCreating] = useState(false);
	const [pending, setPending] = useState<Pending>(null);
	const [busy, setBusy] = useState(false);
	const isAdmin =
		(session?.user as { role?: string } | undefined)?.role === "ADMIN";
	const device = pending?.kind === "device";
	const pendingName =
		pending?.kind === "device"
			? words.client(pending.device.clientId)
			: (pending?.token.name ?? "");

	const confirm = async () => {
		if (!pending) return;
		setBusy(true);
		try {
			if (pending.kind === "key") await revokeToken(pending.token.id);
			else await disconnectDevice(pending.device.token);
			toast.saved(
				t(device ? "disconnected" : "revoked", { name: pendingName }),
			);
			await client.invalidateQueries({ queryKey: device ? DEVICES : KEYS });
			setPending(null);
		} catch (err) {
			toast.failed(err instanceof Error ? err.message : t("failed"));
		} finally {
			setBusy(false);
		}
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
						onRevoke={() => setPending({ kind: "key", token: k })}
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
						key={d.token}
						onDisconnect={() => setPending({ kind: "device", device: d })}
					/>
				))}
			</TokenBlock>
			<CreateTokenSheet
				isAdmin={isAdmin}
				onCreated={() => client.invalidateQueries({ queryKey: KEYS })}
				onOpenChange={setCreating}
				open={creating}
			/>
			<ConfirmationDialog
				confirmLabel={device ? t("disconnect") : t("revoke")}
				description={device ? t("disconnectBody") : t("revokeBody")}
				isLoading={busy}
				onConfirm={() => void confirm()}
				onOpenChange={(o) => {
					if (!o) setPending(null);
				}}
				open={pending != null}
				title={t(device ? "disconnectTitle" : "revokeTitle", {
					name: pendingName,
				})}
				variant="destructive"
			/>
		</SectionShell>
	);
}
