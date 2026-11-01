import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import type { AdminFeedback } from "./types";
import { detailOf } from "./useAdminRead";

type Status = AdminFeedback["status"];

/**
 * One piece of feedback: what the person wrote, who and where it came from,
 * your private note, and what to do with it (mark read or unread, archive,
 * delete). A status change ends in an Undo toast; deleting asks first.
 */
export function FeedbackSheet({
	item,
	onClose,
	onChanged,
}: {
	item: AdminFeedback | null;
	onClose: () => void;
	onChanged: () => Promise<void>;
}) {
	const t = useTranslations("mobile.admin.feedback");
	const tc = useTranslations("mobile.common");
	const format = useFormatter();
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [note, setNote] = useState(item?.adminNote ?? "");
	const [busy, setBusy] = useState(false);

	if (!item) {
		return (
			<Sheet detents={["large"]} onClose={onClose} visible={false}>
				{null}
			</Sheet>
		);
	}
	const entry = item;
	const key = () => ({ context: { idempotencyKey: newClientId() } });
	const noteChanged = note.trim() !== (entry.adminNote ?? "");

	async function guard(work: () => Promise<void>) {
		if (!api || busy) return false;
		setBusy(true);
		try {
			await work();
			await onChanged();
			return true;
		} catch (error) {
			toast.show({ message: detailOf(error) ?? t("error") });
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function move(to: Status) {
		const from = entry.status;
		const ok = await guard(async () => {
			await api?.admin.setFeedbackStatus({ id: entry.id, status: to }, key());
		});
		if (!ok) return;
		onClose();
		toast.show({
			message: t(`moved.${to}`),
			undo: {
				label: tc("undo"),
				onUndo: () => {
					void guard(async () => {
						await api?.admin.setFeedbackStatus(
							{ id: entry.id, status: from },
							key(),
						);
					});
				},
			},
		});
	}

	async function saveNote() {
		const text = note.trim();
		const ok = await guard(async () => {
			await api?.admin.setFeedbackNote(
				{ id: entry.id, note: text === "" ? null : text },
				key(),
			);
		});
		if (ok) {
			onClose();
			toast.show({ message: t("noteSaved") });
		}
	}

	function askDelete() {
		Alert.alert(t("deleteTitle"), undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: t("delete"),
				style: "destructive",
				onPress: () => {
					void (async () => {
						const ok = await guard(async () => {
							await api?.admin.deleteFeedback({ id: entry.id }, key());
						});
						if (!ok) return;
						onClose();
						toast.show({ message: t("deleted") });
					})();
				},
			},
		]);
	}

	const fact = (label: string, value: string | null) =>
		value ? (
			<ListRow
				end={
					<Text numberOfLines={1} style={{ flexShrink: 1 }} tone="fg2">
						{value}
					</Text>
				}
				key={label}
				title={label}
			/>
		) : null;

	return (
		<Sheet
			detents={["large"]}
			footer={
				<Button
					disabled={busy || !noteChanged}
					label={t("saveNote")}
					onPress={() => void saveNote()}
				/>
			}
			onClose={onClose}
			title={t("sheet")}
			visible
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				<Text selectable>{entry.message}</Text>
				<ListGroup>
					{fact(t("from"), entry.user.name)}
					{fact(t("email"), entry.user.email)}
					{fact(
						t("sent"),
						format.dateTime(new Date(entry.createdAt), {
							dateStyle: "medium",
							timeStyle: "short",
						}),
					)}
					{fact(t("page"), entry.pageUrl)}
					{fact(t("version"), entry.appVersion)}
					{fact(t("viewport"), entry.viewportSize)}
					{fact(t("device"), entry.userAgent)}
				</ListGroup>
				<TextField
					label={t("note")}
					maxLength={2000}
					multiline
					onChangeText={setNote}
					value={note}
				/>
				<ListGroup>
					{entry.status === "unread" ? (
						<ListRow onPress={() => void move("read")} title={t("markRead")} />
					) : (
						<ListRow
							onPress={() => void move("unread")}
							title={t("markUnread")}
						/>
					)}
					{entry.status === "archived" ? (
						<ListRow onPress={() => void move("read")} title={t("unarchive")} />
					) : (
						<ListRow
							onPress={() => void move("archived")}
							title={t("archive")}
						/>
					)}
					<ListRow
						onPress={busy ? undefined : askDelete}
						title={
							<Text numberOfLines={1} tone="danger" weight="medium">
								{t("delete")}
							</Text>
						}
					/>
				</ListGroup>
				<View style={{ height: space[2] }} />
			</ScrollView>
		</Sheet>
	);
}
