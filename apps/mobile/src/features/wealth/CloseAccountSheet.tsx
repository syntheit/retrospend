import { useTranslations } from "use-intl";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useOfflineDryRun } from "@/features/recurring/useSettle";
import { Note } from "@/features/write/parts";
import { WriteSheet } from "@/features/write/WriteForm";
import { isLiability } from "./accounts";
import { writeAccountOnDevice } from "./deviceWealth";
import type { Account } from "./source";
import {
	useOpenedAccount,
	useWealthDevice,
	useWealthEnd,
} from "./useWealthDevice";
import { previewWealth } from "./wealthPreview";

/**
 * Close an account (it leaves your accounts and net worth from today; its
 * history stays) or reopen a closed one. Both show the dry run first and end
 * in an Undo toast.
 *
 * Under the dev flag, when the server takes Wealth writes from the phone, the
 * write is booked on the device and queued instead: it waits in the outbox
 * when offline, is checked against the account's version at send, and Undo
 * takes it out of the outbox or through the server once sent. The server's
 * dry run is still what the sheet shows. With either missing it writes online
 * as ever.
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
	const tOffline = useTranslations("mobile.composer.changes");
	const money = useMoneyText();
	const device = useWealthDevice(visible);
	const { opened } = useOpenedAccount(device, account, visible);
	const { offline, track } = useOfflineDryRun();
	const end = useWealthEnd("accounts");
	const op = {
		kind: reopen ? "accountReopen" : "accountClose",
		body: { id: account.id },
	} as const;
	return (
		<WriteSheet
			changes={({ preview, status }) => (
				<PreviewChanges
					message={
						device && offline && status === "failed"
							? tOffline("offline")
							: undefined
					}
					preview={preview}
					status={status}
				/>
			)}
			detent="medium"
			done={
				device
					? (out) =>
							end(out, {
								device,
								title: account.name,
								message: t("toast", { name: account.name }),
								onChanged: onDone,
							})
					: undefined
			}
			family="accounts"
			input={{ id: account.id }}
			message={() => t("toast", { name: account.name })}
			onClose={onClose}
			onDone={onDone}
			preview={(api, body) => {
				const run = (options?: { signal: AbortSignal }) =>
					reopen
						? api.accounts.previewReopen(body, options)
						: api.accounts.previewClose(body, options);
				return device ? track(previewWealth(device, op, run)) : run();
			}}
			queuesOffline={device !== null && offline}
			submitLabel={t("submit")}
			title={t("title", { name: account.name })}
			visible={visible}
			write={async (api, body, key) => {
				if (device) {
					const queued = await writeAccountOnDevice({
						device,
						op,
						opened,
						title: account.name,
					});
					if (queued.settled !== "online") return queued;
				}
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
