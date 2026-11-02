import { useRef } from "react";
import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useResetOnOpen } from "@/features/write/useResetOnOpen";
import { WriteSheet } from "@/features/write/WriteForm";
import { Button } from "@/ui/Button";
import type { Account } from "./source";

/**
 * Delete an account and its whole balance history. The dry run says what net
 * worth would do before the verb is on, and the toast that follows has Undo:
 * the server keeps the account and its history for a day and puts it all back.
 * An open account offers Close instead, which keeps the history, in the body;
 * the footer is Cancel, then the destructive verb.
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
	// The screen leaves once, when the account goes; an Undo only refreshes.
	const gone = useRef(false);
	useResetOnOpen(visible, () => {
		gone.current = false;
	});
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges preview={preview} status={status} />
			)}
			destructive={{ label: t("submit"), busyLabel: t("deleting") }}
			detent="medium"
			error={t("error")}
			family="accounts"
			input={{ id: account.id }}
			message={() => t("toast", { name: account.name })}
			onClose={onClose}
			onDone={() => {
				if (gone.current) return;
				gone.current = true;
				onDone();
			}}
			preview={(api, body) => api.accounts.previewDelete(body)}
			title={t("title", { name: account.name })}
			visible={visible}
			write={(api, body, key) =>
				api.accounts.delete(body, { context: { idempotencyKey: key } })
			}
		>
			{account.closedAt === null ? (
				<Button
					label={t("closeInstead")}
					onPress={onCloseInstead}
					variant="outlined"
				/>
			) : null}
		</WriteSheet>
	);
}
