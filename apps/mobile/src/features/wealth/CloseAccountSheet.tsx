import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { Note, SheetBody } from "@/features/budget/parts";
import { useMoneyWrite, useWriteIds } from "@/features/budget/useMoneyWrite";
import { useUndoToast } from "@/features/budget/useUndoToast";
import { noSession, useApi, WriteFrame } from "@/features/budget/WriteFrame";
import { PreviewChanges } from "@/features/read/PreviewChanges";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
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
	const api = useApi();
	const announce = useUndoToast("accounts");
	const money = useMoneyText();
	const input = { id: account.id };
	const { idFor, reset } = useWriteIds(JSON.stringify(input));
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening gets a fresh write id
	useEffect(() => {
		if (visible) reset();
	}, [visible]);

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: idFor("write"),
		preview: (body) =>
			api
				? reopen
					? api.accounts.previewReopen(body)
					: api.accounts.previewClose(body)
				: noSession(),
		write: (body, key) => {
			if (!api) return noSession();
			const options = { context: { idempotencyKey: key } };
			return reopen
				? api.accounts.reopen(body, options)
				: api.accounts.close(body, options);
		},
	});

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
			onClose={onClose}
			title={t("title", { name: account.name })}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						<PreviewChanges preview={flow.preview} status={flow.status} />
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready"}
					submitLabel={t("submit")}
				>
					<Note>{t("body", { name: account.name })}</Note>
					{!reopen && account.balance.minor !== 0 ? (
						<Note tone="attention">
							{t("left", { amount: money(account.balance) })}
						</Note>
					) : null}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
