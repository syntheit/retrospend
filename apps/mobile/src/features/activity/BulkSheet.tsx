import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { ChangesBlock } from "@/features/entry/ChangesBlock";
import { announceEntryChange } from "@/features/entry/events";
import type { PreviewState } from "@/features/entry/preview";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import {
	type BulkAction,
	previewBulk,
	runBulk,
	skippedOf,
	undoBulk,
} from "./bulkWrite";

/**
 * Delete or Categorize over the picked expenses (the web's bulk bar). The
 * sheet shows the server's dry run of the write before Save and says what it
 * will not touch, the button names the action, and the toast that follows
 * carries Undo for the whole batch (R30, R15).
 */
export function BulkSheet({
	action,
	ids,
	onClose,
	onDone,
}: {
	/** Null: the sheet is closed. */
	action: BulkAction | null;
	/** The entry ids of the picked expenses. */
	ids: readonly string[];
	onClose: () => void;
	/** The write went through: leave select mode. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.activity.bulk");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { color, space, type } = useTheme();
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	// One id per opening: a second tap on Save replays the first write.
	const batch = useRef("");

	const open = action !== null;
	const key = action ? JSON.stringify([action, ids]) : "";
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `action` and `ids`
	useEffect(() => {
		if (!action || !api) return;
		let cancelled = false;
		batch.current = newClientId();
		setPreview({ status: "loading" });
		setFailed(false);
		previewBulk(api, action, ids).then((state) => {
			if (!cancelled) setPreview(state);
		});
		return () => {
			cancelled = true;
		};
	}, [key, api]);

	async function save() {
		if (!action || !api || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			const out = await runBulk(api, action, ids, batch.current);
			announceEntryChange();
			if (out.done === 0) {
				setFailed(true);
				return;
			}
			const count = out.done;
			const message =
				action.kind === "category"
					? t("moved", { count, name: action.name })
					: out.failed > 0
						? t("deletedSome", { count, left: out.failed })
						: t("deleted", { count });
			const undoBatch = batch.current;
			toast.show({
				message,
				undo: {
					label: tc("undo"),
					onUndo: async () => {
						const ok = await undoBulk(api, out.tokens, undoBatch);
						announceEntryChange();
						toast.show({ message: ok ? t("undone") : t("undoError") });
					},
				},
			});
			onDone();
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	const count = ids.length;
	const title =
		action?.kind === "delete"
			? t("deleteTitle", { count })
			: t("categorizeTitle", { count });
	const ready = preview.status === "ready";
	const skipped =
		ready && action?.kind === "delete" ? skippedOf(preview.diff) : 0;

	return (
		<Sheet onClose={onClose} title={title} visible={open}>
			<View style={{ gap: space[4] }}>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{action?.kind === "delete"
						? t("deleteBody")
						: t("categorizeBody", {
								name: action?.kind === "category" ? action.name : "",
							})}
				</Text>
				<ChangesBlock idle="" state={preview} />
				{skipped > 0 ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{t("skipped", { count: skipped })}
					</Text>
				) : null}
				{failed ? (
					<Text
						accessibilityLiveRegion="polite"
						style={{ color: color.attentionText, fontSize: type.body.size }}
					>
						{t("failed")}
					</Text>
				) : null}
				<Button
					disabled={!ready || busy}
					label={
						busy
							? tc("saving")
							: action?.kind === "delete"
								? t("deleteButton", { count })
								: t("categorizeButton", {
										name: action?.kind === "category" ? action.name : "",
									})
					}
					onPress={() => void save()}
				/>
				<Button label={tc("cancel")} onPress={onClose} variant="text" />
			</View>
		</Sheet>
	);
}
