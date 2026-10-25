import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { minorOf, readAmount, wireAmount } from "@/features/budget/amount";
import { figureLines } from "@/features/budget/figures";
import {
	AmountField,
	ChangeList,
	type ChangeRow,
	Note,
	SheetBody,
	useAmountLocale,
} from "@/features/budget/parts";
import { useFigureLabel } from "@/features/budget/useFigureLabel";
import { useMoneyWrite, useWriteIds } from "@/features/budget/useMoneyWrite";
import { useUndoToast } from "@/features/budget/useUndoToast";
import { noSession, useApi, WriteFrame } from "@/features/budget/WriteFrame";
import { useMoneyText } from "@/features/read/useMoneyText";
import { Sheet } from "@/ui/Sheet";
import { ACCOUNT_BALANCE, balanceRows, isUnchanged } from "./balance";
import type { AccountDetail } from "./source";

/**
 * Say what the account holds today. The server works out the difference and
 * records it as Not logged (not income, not spending); the dry run shows the
 * account's new balance, net worth, and that difference before Update is on.
 * The toast undoes it.
 */
export function UpdateBalanceSheet({
	account,
	visible,
	onClose,
	onDone,
}: {
	account: AccountDetail;
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.wealth.update");
	const tp = useTranslations("mobile.budget.preview");
	const api = useApi();
	const announce = useUndoToast("accounts");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const currency = account.balance.currency;
	const [draft, setDraft] = useState("");
	const entered = readAmount(draft, locale, currency);
	// Zero is a real balance: an empty account, a paid-off card.
	const minor = minorOf(entered, true);
	const bodyKey =
		minor === null ? null : JSON.stringify({ minor, id: account.id });
	const { idFor, reset } = useWriteIds(bodyKey);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty and fresh
	useEffect(() => {
		if (!visible) return;
		setDraft("");
		reset();
	}, [visible]);
	const input =
		minor === null
			? null
			: { id: account.id, balance: wireAmount(minor, currency) };

	const flow = useMoneyWrite({
		input: visible ? input : null,
		idempotencyKey: input ? idFor("write") : null,
		preview: (body) =>
			api ? api.accounts.previewUpdateBalance(body) : noSession(),
		write: (body, key) =>
			api
				? api.accounts.updateBalance(body, { context: { idempotencyKey: key } })
				: noSession(),
	});

	const rows = flow.preview ? balanceRows(flow.preview) : null;
	const lines = flow.preview
		? figureLines(flow.preview, [ACCOUNT_BALANCE])
		: null;
	const label = useFigureLabel();
	const side = (value: { minor: number; currency: string } | null) =>
		value ? money(value) : tp("notAvailable");
	const pair = (
		before: { minor: number; currency: string } | null,
		after: { minor: number; currency: string } | null,
	) => tp("beforeAfter", { before: side(before), after: side(after) });
	const changes: ChangeRow[] = [];
	if (rows?.balance) {
		changes.push({
			key: "balance",
			label: account.name,
			value: pair(rows.balance.before, rows.balance.after),
		});
	}
	for (const change of lines?.changes ?? []) {
		changes.push({
			key: change.key,
			label: label(change.id).name,
			value: pair(change.before, change.after),
		});
	}
	if (rows?.notLogged) {
		changes.push({
			key: "notLogged",
			label: t("notLogged"),
			value: money(rows.notLogged, { sign: "exceptZero" }),
		});
	}
	const same = rows ? isUnchanged(rows) : false;

	async function submit() {
		const out = await flow.commit();
		if (!out || minor === null) return;
		announce({
			message: t("toast", {
				name: account.name,
				amount: money({ minor, currency }),
			}),
			token: out.undo,
			onChanged: onDone,
		});
		onClose();
	}

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={flow.committing}
					changes={
						same ? (
							<Note>{t("same")}</Note>
						) : (
							<>
								<ChangeList
									changes={changes}
									status={flow.status}
									stays={(lines?.stays ?? []).map((id) => label(id).inline)}
									unavailable={(lines?.unavailable ?? []).map(
										(id) => label(id).inline,
									)}
								/>
								{rows?.notLogged ? <Note>{t("notLoggedHint")}</Note> : null}
							</>
						)
					}
					failed={flow.commitFailed}
					onSubmit={submit}
					ready={flow.status === "ready" && !same}
					submitLabel={t("submit")}
				>
					<Note>
						{t("now", { name: account.name, amount: money(account.balance) })}
					</Note>
					<AmountField
						allowZero
						currency={currency}
						draft={draft}
						entered={entered}
						label={t("amount")}
						onDraftChange={setDraft}
					/>
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
