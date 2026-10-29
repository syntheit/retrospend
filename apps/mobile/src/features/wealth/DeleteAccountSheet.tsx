import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note, SheetBody } from "@/features/write/parts";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import type { Account } from "./source";

/**
 * Delete an account and its whole balance history, for good. The dry run says
 * what net worth would do before the verb is on; the server cannot take this
 * back (the history goes with the account), so the toast has no Undo and the
 * sheet says so. An open account offers Close instead, which keeps the
 * history, next to the destructive verb, which comes last.
 */
export function DeleteAccountSheet({
	account,
	visible,
	onClose,
	onCloseInstead,
	onDone,
}: {
	account: Account;
	visible: boolean;
	onClose: () => void;
	/** Opens the Close sheet for the same account. */
	onCloseInstead: () => void;
	/** The account is gone: the screen behind refreshes or leaves. */
	onDone: () => void;
}) {
	const t = useTranslations("mobile.wealth.delete");
	const api = useApi();
	const announce = useUndoToast("accounts");
	const input = { id: account.id };
	const { idFor, reset } = useWriteIds(JSON.stringify(input));
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening gets a fresh write id
	useEffect(() => {
		if (visible) reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: idFor("write"),
		preview: (body) => (api ? api.accounts.previewDelete(body) : noSession()),
		write: (body, key) =>
			api
				? api.accounts.delete(body, { context: { idempotencyKey: key } })
				: noSession(),
	});
	const open = account.closedAt === null;

	async function submit() {
		const out = await flow.commit();
		if (!out) return;
		announce({
			message: t("toast", { name: account.name }),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={["medium"]}
			footer={
				<>
					{open ? (
						<Button
							label={t("closeInstead")}
							onPress={onCloseInstead}
							variant="outlined"
						/>
					) : null}
					<Button
						disabled={flow.status !== "ready" || flow.committing}
						label={flow.committing ? t("deleting") : t("submit")}
						onPress={submit}
						variant="danger"
					/>
				</>
			}
			onClose={onClose}
			title={t("title", { name: account.name })}
			visible={visible}
		>
			<SheetBody>
				<Note>{t("body")}</Note>
				{open ? <Note>{t("keepHistory")}</Note> : null}
				<PreviewChanges preview={flow.preview} status={flow.status} />
				{flow.commitFailed ? <Note tone="attention">{t("error")}</Note> : null}
			</SheetBody>
		</Sheet>
	);
}
