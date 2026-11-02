import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import { PreviewList } from "@/features/settle/PreviewList";
import type { PaymentPreview } from "@/features/settle/plan";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

/**
 * Delete a project, for its Owner. Its expenses and payments go with it and
 * everyone's balances change, so the sheet shows what the server's dry run
 * says it changes and what it keeps before the one red button. The write
 * carries one key for the whole sheet. The server keeps nothing to take it
 * back with, so this one ends with a plain toast, not Undo.
 */
export function DeleteProjectSheet({
	projectId,
	projectName,
	visible,
	onClose,
	onDeleted,
}: {
	projectId: string;
	projectName: string;
	visible: boolean;
	onClose: () => void;
	/** The project is gone: leave its page. */
	onDeleted: () => void;
}) {
	const t = useTranslations("mobile.projects.delete");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [preview, setPreview] = useState<PaymentPreview | null>(null);
	const [failed, setFailed] = useState<"preview" | "delete" | null>(null);
	const [busy, setBusy] = useState(false);
	const key = useRef(newClientId());

	useEffect(() => {
		if (!visible || !api) return;
		let live = true;
		key.current = newClientId();
		setPreview(null);
		setFailed(null);
		api.projects
			.previewDelete({ id: projectId })
			.then((result) => live && setPreview(result))
			.catch(() => live && setFailed("preview"));
		return () => {
			live = false;
		};
	}, [visible, api, projectId]);

	async function remove() {
		if (!api || busy) return;
		setBusy(true);
		setFailed(null);
		try {
			await api.projects.delete(
				{ id: projectId },
				{ context: { idempotencyKey: key.current } },
			);
		} catch {
			setFailed("delete");
			setBusy(false);
			return;
		}
		setBusy(false);
		announceEntryChange();
		onClose();
		onDeleted();
		toast.show({ message: t("deleted", { name: projectName }) });
	}

	return (
		<Sheet
			detents={["large"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						busy={busy}
						disabled={!preview || busy}
						label={busy ? t("deleting") : t("confirm")}
						onPress={() => void remove()}
						variant="danger"
					/>
				</>
			}
			onClose={onClose}
			title={t("title", { name: projectName })}
			visible={visible}
		>
			<View style={{ ...body }}>
				<ScrollView
					contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				>
					{preview ? (
						<PreviewList name={projectName} preview={preview} />
					) : failed === "preview" ? (
						<Text tone="attention">{t("previewError")}</Text>
					) : (
						<Text tone="fg2">{t("checking")}</Text>
					)}
					{failed === "delete" ? (
						<Text accessibilityRole="alert" tone="attention">
							{t("error")}
						</Text>
					) : null}
				</ScrollView>
			</View>
		</Sheet>
	);
}
