import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Note } from "@/features/write/parts";
import { WriteSheet } from "@/features/write/WriteForm";
import { isLiability } from "./accounts";
import type { Account } from "./source";

/**
 * Close an account (it leaves your accounts and net worth from today; its
 * history stays) or reopen a closed one. Both show the dry run first and end
 * in an Undo toast.
 */
export function CloseAccountSheet({
	account,
	reopen,
	visible,
	onClose,
	onDone,
}: {
	account: Account;
	reopen: boolean;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations(
		reopen ? "mobile.wealth.reopen" : "mobile.wealth.close",
	);
	const money = useMoneyText();
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges preview={preview} status={status} />
			)}
			detent="medium"
			family="accounts"
			input={{ id: account.id }}
			message={() => t("toast", { name: account.name })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) =>
				reopen
					? api.accounts.previewReopen(body)
					: api.accounts.previewClose(body)
			}
			submitLabel={t("submit")}
			title={t("title", { name: account.name })}
			visible={visible}
			write={(api, body, key) => {
				const options = { context: { idempotencyKey: key } };
				return reopen
					? api.accounts.reopen(body, options)
					: api.accounts.close(body, options);
			}}
		>
			<Note>{t("body", { name: account.name })}</Note>
			{!reopen && account.balance.minor !== 0 ? (
				<Note tone="attention">
					{t("left", {
						amount: money(account.balance, {
							sign: isLiability(account.type) ? "never" : "auto",
						}),
					})}
				</Note>
			) : null}
		</WriteSheet>
	);
}
