import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { minorOf, readAmount, wireAmount } from "@/features/budget/amount";
import {
	AmountField,
	ChangeList,
	type ChangeRow,
	Note,
	useAmountLocale,
} from "@/features/budget/parts";
import { useMoneyWrite, useWriteIds } from "@/features/budget/useMoneyWrite";
import { useUndoToast } from "@/features/budget/useUndoToast";
import { noSession, useApi, WriteFrame } from "@/features/budget/WriteFrame";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Sheet } from "@/ui/Sheet";
import { balanceRows, isUnchanged } from "./balance";
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
	const { space } = useTheme();
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
	const pair = (before: string, after: string) =>
		tp("beforeAfter", { before, after });
	const changes: ChangeRow[] = [];
	if (rows?.balance) {
		const value = pair(money(rows.balance.before), money(rows.balance.after));
		changes.push({ key: "balance", label: account.name, value });
	}
	if (rows?.netWorth) {
		const none = tp("none");
		changes.push({
			key: "net",
			label: t("netWorth"),
			value: pair(
				rows.netWorth.before ? money(rows.netWorth.before) : none,
				rows.netWorth.after ? money(rows.netWorth.after) : none,
			),
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
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				<WriteFrame
					busy={flow.committing}
					changes={
						same ? (
							<Note>{t("same")}</Note>
						) : (
							<>
								<ChangeList changes={changes} status={flow.status} stays={[]} />
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
			</ScrollView>
		</Sheet>
	);
}
