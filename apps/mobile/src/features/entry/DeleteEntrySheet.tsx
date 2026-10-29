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
import { type DeleteKind, previewDelete, runDelete } from "./deleteEntry";
import { announceEntryChange } from "./events";
import type { PreviewState } from "./preview";
import { undoWrite } from "./send";

/**
 * Delete the expense an edit is open on. The sheet says what it will change
 * and what it will not, from the server's dry run, before the button
 * deletes; a personal expense then ends in a toast with Undo. A split asks
 * first because it changes what other people owe, and the server keeps no
 * undo for it, so its toast has none.
 */
export function DeleteEntrySheet({
	visible,
	kind,
	id,
	title,
	onClose,
	onDeleted,
}: {
	visible: boolean;
	kind: DeleteKind;
	id: string;
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
		setFailed(false);
		previewDelete(api, kind, id).then((state) => {
			if (!cancelled) setPreview(state);
		});
		return () => {
			cancelled = true;
		};
	}, [visible, api, kind, id, attempt]);

	async function remove() {
		if (!api || busy || preview.status !== "ready") return;
		setBusy(true);
		setFailed(false);
		const outcome = await runDelete(api, kind, id, key.current).finally(() =>
			setBusy(false),
		);
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
			footer={
				<>
					<Button label={tc("cancel")} onPress={onClose} variant="text" />
					<Button
						disabled={preview.status !== "ready" || busy}
						label={busy ? tc("saving") : t("button")}
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
				<Text tone="fg2">
					{kind === "shared" ? t("bodyShared") : t("body")}
				</Text>
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
