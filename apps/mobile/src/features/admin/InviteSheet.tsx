import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Share, View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { inviteLink } from "./rules";
import type { InviteCodeDto } from "./types";
import { detailOf } from "./useAdminRead";

/**
 * One invite code: the code itself, then copy it, copy the sign-up link,
 * share the link, or delete the code. Deleting asks first, and the code stops
 * working at once.
 */
export function InviteSheet({
	invite,
	onClose,
	onChanged,
}: {
	invite: InviteCodeDto | null;
	onClose: () => void;
	onChanged: () => Promise<void>;
}) {
	const t = useTranslations("mobile.admin.invites");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const { connection } = useServerConnection();
	const toast = useToast();
	const { space } = useTheme();
	const [busy, setBusy] = useState(false);
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;

	if (!invite) {
		return (
			<Sheet detents={["medium"]} onClose={onClose} visible={false}>
				{null}
			</Sheet>
		);
	}
	const code = invite.code;

	async function copy(text: string, done: string) {
		try {
			await Clipboard.setStringAsync(text);
			onClose();
			toast.show({ message: done });
		} catch {
			toast.show({ message: t("copyFailed") });
		}
	}

	async function share() {
		if (!baseUrl) return;
		try {
			await Share.share({ message: inviteLink(baseUrl, code) });
		} catch {
			toast.show({ message: t("shareFailed") });
		}
	}

	function askDelete() {
		Alert.alert(t("deleteTitle"), t("deleteBody", { code }), [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("delete"),
				style: "destructive",
				onPress: () => {
					void (async () => {
						if (!api || busy) return;
						setBusy(true);
						try {
							await api.admin.deleteInviteCode(
								{ id: invite?.id ?? "" },
								{ context: { idempotencyKey: newClientId() } },
							);
							onClose();
							await onChanged();
							toast.show({ message: t("deleted") });
						} catch (error) {
							toast.show({ message: detailOf(error) ?? t("deleteError") });
						} finally {
							setBusy(false);
						}
					})();
				},
			},
		]);
	}

	return (
		<Sheet detents={["medium"]} onClose={onClose} title={t("sheet")} visible>
			<View style={{ gap: space[4] }}>
				<Text selectable variant="section">
					{code}
				</Text>
				<ListGroup>
					<ListRow
						onPress={() => void copy(code, t("codeCopied"))}
						title={t("copyCode")}
					/>
					{baseUrl ? (
						<ListRow
							onPress={() =>
								void copy(inviteLink(baseUrl, code), t("linkCopied"))
							}
							title={t("copyLink")}
						/>
					) : null}
					{baseUrl ? (
						<ListRow onPress={() => void share()} title={t("share")} />
					) : null}
					<ListRow
						onPress={busy ? undefined : askDelete}
						title={
							<Text numberOfLines={1} tone="danger" weight="medium">
								{t("delete")}
							</Text>
						}
					/>
				</ListGroup>
			</View>
		</Sheet>
	);
}
