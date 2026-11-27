import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { deviceFlagOn } from "@/data/deviceWrites";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { Note } from "@/features/write/parts";
import { useResetOnOpen } from "@/features/write/useResetOnOpen";
import { WriteSheet } from "@/features/write/WriteForm";
import { Button } from "@/ui/Button";
import { accountHasWrites } from "./deviceWealth";
import type { Account } from "./source";

/**
 * Delete an account and its whole balance history. The dry run says what net
 * worth would do before the verb is on, and the toast that follows has Undo:
 * the server keeps the account and its history for a day and puts it all back.
 * An open account offers Close instead, which keeps the history, in the body;
 * the footer is Cancel, then the destructive verb.
 *
 * Delete stays online under the dev flag too (the server stashes the account
 * with its transfers and signs its own Undo). While this phone holds a write
 * about the account that no pull has shown back, it says "Sync first" and
 * deletes nothing.
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
	// Under the flag the phone's own outbox is read whether or not the engine
	// runs yet, and one that cannot be read counts as a write waiting.
	const { local } = useSession();
	const guarded = deviceFlagOn();
	const outbox = local?.outbox ?? null;
	const [syncFirst, setSyncFirst] = useState(false);
	useEffect(() => {
		setSyncFirst(false);
		if (!guarded || !visible) return;
		let live = true;
		void accountHasWrites(outbox, account.id).then(
			(waiting) => live && setSyncFirst(waiting),
		);
		return () => {
			live = false;
		};
	}, [guarded, outbox, visible, account.id]);
	return (
		<WriteSheet
			changes={({ preview, status }) =>
				syncFirst ? (
					<Note tone="attention">{t("syncFirst")}</Note>
				) : (
					<PreviewChanges preview={preview} status={status} />
				)
			}
			destructive={{ label: t("submit"), busyLabel: t("deleting") }}
			detent="medium"
			error={t("error")}
			family="accounts"
			input={syncFirst ? null : { id: account.id }}
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
			write={async (api, body, key) => {
				// Checked again at the write: an entry may have been queued since the sheet opened.
				if (guarded && (await accountHasWrites(outbox, body.id))) {
					setSyncFirst(true);
					throw new Error("Sync first");
				}
				return api.accounts.delete(body, { context: { idempotencyKey: key } });
			}}
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
