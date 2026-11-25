import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { ChangesBlock } from "@/features/entry/ChangesBlock";
import { announceEntryChange } from "@/features/entry/events";
import type { PreviewState } from "@/features/entry/preview";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import {
	type BulkAction,
	bulkDevice,
	previewBulk,
	runBulk,
	SyncFirstError,
	skippedOf,
	undoBulk,
	unsyncedIds,
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
	const { api, local } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	// Dev flag: a picked expense has a write that has not synced.
	const [syncFirst, setSyncFirst] = useState(false);
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
		setSyncFirst(false);
		const device = bulkDevice(api, local?.outbox);
		const blocked = device
			? unsyncedIds(device, ids).then((held) => held.length > 0)
			: Promise.resolve(false);
		blocked.then((held) => {
			if (cancelled) return;
			if (held) return setSyncFirst(true);
			previewBulk(api, action, ids, device).then((state) => {
				if (!cancelled) setPreview(state);
			});
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
			const device = bulkDevice(api, local?.outbox);
			const out = await runBulk(api, action, ids, batch.current, device);
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
						const ok = await undoBulk(api, out.tokens, undoBatch, device);
						announceEntryChange();
						toast.show({ message: ok ? t("undone") : t("undoError") });
					},
				},
			});
			onDone();
			onClose();
		} catch (error) {
			if (error instanceof SyncFirstError) setSyncFirst(true);
			else setFailed(true);
		} finally {
			setBusy(false);
		}
	}

	const count = ids.length;
	const title =
		action?.kind === "delete"
			? t("deleteTitle", { count })
			: t("categorizeTitle", { count });
	const ready = preview.status === "ready" && !syncFirst;
	const skipped =
		ready && action?.kind === "delete" ? skippedOf(preview.diff) : 0;

	return (
		<Sheet
			detents={action?.kind === "delete" ? ["medium"] : undefined}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						busy={busy}
						disabled={!ready || busy}
						label={
							busy
								? action?.kind === "delete"
									? tc("deleting")
									: tc("saving")
								: action?.kind === "delete"
									? t("deleteButton", { count })
									: t("categorizeButton", {
											name: action?.kind === "category" ? action.name : "",
										})
						}
						onPress={() => void save()}
						variant={action?.kind === "delete" ? "danger" : "filled"}
					/>
				</>
			}
			footerApart={action?.kind === "delete"}
			onClose={onClose}
			title={title}
			visible={open}
		>
			<View style={{ gap: space[4] }}>
				{action?.kind === "delete" ? null : (
					<Text tone="fg2">
						{t("categorizeBody", {
							name: action?.kind === "category" ? action.name : "",
						})}
					</Text>
				)}
				{syncFirst ? (
					<Text accessibilityLiveRegion="polite" tone="attention">
						{t("syncFirst")}
					</Text>
				) : (
					<ChangesBlock idle="" state={preview} />
				)}
				{skipped > 0 ? (
					<Text tone="fg2" variant="small">
						{t("skipped", { count: skipped })}
					</Text>
				) : null}
				{failed ? (
					<Text accessibilityLiveRegion="polite" tone="attention">
						{t("failed")}
					</Text>
				) : null}
			</View>
		</Sheet>
	);
}
