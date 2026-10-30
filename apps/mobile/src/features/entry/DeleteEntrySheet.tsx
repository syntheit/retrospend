import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { ChangesBlock } from "./ChangesBlock";
import { previewDelete, runDelete } from "./deleteEntry";
import { announceEntryChange } from "./events";
import type { PreviewState } from "./preview";
import { undoWrite } from "./send";

/**
 * Delete the expense an edit is open on, on the one confirm shape for money
 * deletes: a medium sheet titled with the object, the preview, then Cancel
 * and the verb that names the object. The sheet says what it will change
 * and what it will not, from the server's dry run, before the button
 * deletes, and the toast that follows has Undo. A split expense changes what
 * other people owe: when the server would erase a debt or leave the payer
 * owing, its warning is on the sheet and the button reads "Delete anyway".
 * Nothing confirms for you, and Undo brings back every share.
 */
export function DeleteEntrySheet({
	visible,
	id,
	shared = false,
	title,
	onClose,
	onDeleted,
}: {
	visible: boolean;
	id: string;
	/** A split expense: its own routes, its warning and its words. */
	shared?: boolean;
	/** What the toast calls it. */
	title: string;
	onClose: () => void;
	/** It is gone: close the composer. */
	onDeleted: () => void;
}) {
	const t = useTranslations("mobile.composer.delete");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const toast = useToast();
	const { space } = useTheme();
	const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
	const [warning, setWarning] = useState<string | null>(null);
	const [undoable, setUndoable] = useState(true);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	// One key per opening: a second tap replays the first delete.
	const key = useRef("");
	const [attempt, setAttempt] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks the dry run again
	useEffect(() => {
		if (!visible || !api) return;
		let cancelled = false;
		key.current = newClientId();
		setPreview({ status: "loading" });
		setWarning(null);
		setUndoable(true);
		setFailed(false);
		previewDelete(api, { id, shared }).then((out) => {
			if (cancelled) return;
			setPreview(out.state);
			setWarning(out.warning);
			setUndoable(out.undoable);
		});
		return () => {
			cancelled = true;
		};
	}, [visible, api, id, shared, attempt]);

	async function remove() {
		if (!api || busy || preview.status !== "ready") return;
		setBusy(true);
		setFailed(false);
		const outcome = await runDelete(
			api,
			{ id, shared },
			key.current,
			warning !== null,
		).finally(() => setBusy(false));
		if (outcome.status !== "deleted") {
			setFailed(true);
			return;
		}
		announceEntryChange();
		const { undo } = outcome;
		toast.show({
			message: t("deleted", { title }),
			undo: undo
				? {
						label: tc("undo"),
						onUndo: async () => {
							const ok = await undoWrite(api, undo, newClientId()).then(
								() => true,
								() => false,
							);
							announceEntryChange();
							toast.show({
								message: ok ? t("restored", { title }) : t("undoFailed"),
							});
						},
					}
				: undefined,
		});
		onClose();
		onDeleted();
	}

	return (
		<Sheet
			detents={["medium"]}
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						disabled={preview.status !== "ready" || busy}
						label={busy ? tc("deleting") : warning ? t("anyway") : t("button")}
						onPress={() => void remove()}
						variant="danger"
					/>
				</>
			}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<View style={{ gap: space[4] }}>
				<Text tone="fg2">{shared ? t("sharedBody") : t("body")}</Text>
				{undoable ? null : <Text tone="fg2">{t("noUndo")}</Text>}
				{warning ? (
					<Text accessibilityLiveRegion="polite" tone="attention">
						{warning}
					</Text>
				) : null}
				<ChangesBlock
					idle=""
					onRetry={() => setAttempt((n) => n + 1)}
					state={preview}
				/>
				{failed ? (
					<Text accessibilityLiveRegion="polite" tone="attention">
						{t("failed")}
					</Text>
				) : null}
			</View>
		</Sheet>
	);
}
