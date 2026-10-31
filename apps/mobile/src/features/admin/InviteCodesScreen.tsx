import { Stack } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { AddButton } from "@/ui/AddButton";
import { useToast } from "@/ui/Toast";
import { TopBarAction } from "@/ui/TopBarAction";
import { Block, SettingsPage } from "../settings/parts";
import {
	InviteCodeList,
	type InviteStatus,
	readInviteCodes,
} from "./InviteCodeList";
import { InviteSheet } from "./InviteSheet";
import { detailOf, useAdminRead } from "./useAdminRead";

/**
 * Your own invite codes, for a person the server lets invite (the web's
 * Invite codes page). The plus in the bar makes a code and opens it; tapping
 * one opens its sheet to copy, share the sign-up link or delete it. None of
 * the server's invite settings are here: those are Admin's.
 */
export function InviteCodesScreen() {
	const t = useTranslations("mobile.admin.invites");
	const { api } = useSession();
	const toast = useToast();
	const [status, setStatus] = useState<InviteStatus>("active");
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const codes = useAdminRead(
		(client) =>
			readInviteCodes((query) => client["invite-codes"].list(query), status),
		status,
	);

	async function create() {
		if (!api || creating) return;
		setCreating(true);
		try {
			const made = await api["invite-codes"].create(undefined, {
				context: { idempotencyKey: newClientId() },
			});
			setStatus("active");
			await codes.reload();
			setOpenId(made.id);
			toast.show({ message: t("created") });
		} catch (error) {
			toast.show({ message: detailOf(error) ?? t("createError") });
		} finally {
			setCreating(false);
		}
	}

	const items = codes.state.status === "ready" ? codes.state.data : null;
	const open = items?.find((code) => code.id === openId) ?? null;

	return (
		<>
			<Stack.Screen
				options={{
					headerRight: () =>
						Platform.OS === "ios" ? (
							<AddButton label={t("create")} onPress={() => void create()} />
						) : (
							<TopBarAction
								icon="Plus"
								id="create"
								label={t("create")}
								onPress={() => {
									if (!creating) void create();
								}}
							/>
						),
				}}
			/>
			<SettingsPage>
				<Block title={t("codes")}>
					<InviteCodeList
						codes={codes}
						mine
						onOpen={setOpenId}
						onStatus={setStatus}
						status={status}
					/>
				</Block>
			</SettingsPage>
			<InviteSheet
				invite={open}
				key={open?.id ?? "none"}
				mine
				onChanged={codes.reload}
				onClose={() => setOpenId(null)}
			/>
		</>
	);
}
