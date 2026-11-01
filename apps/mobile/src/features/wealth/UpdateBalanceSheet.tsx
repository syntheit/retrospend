import { useEffect, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { AmountEntry } from "@/features/entry/AmountEntry";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import { figureLines } from "@/features/write/figures";
import { KeypadForm } from "@/features/write/KeypadForm";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useAmountLine } from "@/features/write/useAmountLine";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import { useFoldingPad } from "@/features/write/useFoldingPad";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { useTheme } from "@/theme";
import { ChangeList, type ChangeRow } from "@/ui/ChangeList";
import { IconTile } from "@/ui/IconTile";
import { useRateTypeLabel } from "@/ui/Money";
import { Sheet, type SheetDetent, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { glyphOf } from "./accounts";
import { ACCOUNT_BALANCE, balanceRows, isUnchanged } from "./balance";
import { RateTypeChips } from "./RateTypeChips";
import { rateTypeChanged, rateTypesOf } from "./rateType";
import type { Account, CurrencyInfo } from "./source";

/**
 * Update balance rests at large only. Its body is the account, the amount and
 * the whole keypad; at medium (half the window) the keypad stopped after 4 5 6
 * and 7 8 9 0 needed a drag up before a balance could be typed. At large the
 * whole keypad and the Update balance button are in view.
 */
export const UPDATE_BALANCE_DETENTS: SheetDetent[] = ["large"];

/**
 * Say what the account holds today, on the composer's footing: the account and
 * what it shows now, the new balance as the big figure, the rate type it is
 * valued at from today (earlier days keep theirs), What this changes, and the
 * keypad that folds into one Update balance button. Picking a rate type puts
 * the keypad away; tapping the figure brings it back. The server works out
 * the difference and records it as Not logged (not income, not spending); the
 * dry run shows the account's new balance, net worth and that difference
 * before Update is on. The toast undoes it.
 */
export function UpdateBalanceSheet({
	account,
	visible,
	home,
	catalog,
	onClose,
	onDone,
}: {
	account: Account;
	visible: boolean;
	home: string;
	catalog: readonly CurrencyInfo[];
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.wealth.update");
	const tp = useTranslations("mobile.budget.preview");
	const format = useFormatter();
	const api = useApi();
	const announce = useUndoToast("accounts");
	const money = useMoneyText();
	const rateName = useRateTypeLabel();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const body = useSheetBodySize();
	const currency = account.balance.currency;
	const types = rateTypesOf(catalog, currency, home);
	const saved = account.rateType;
	const [draft, setDraft] = useState("");
	const [rateType, setRateType] = useState<string | null>(saved);
	const entered = readAmount(draft, locale, currency);
	// Zero is a real balance: an empty account, a paid-off card.
	const minor = minorOf(entered, true);
	// The keypad is up on opening; a pick of a rate type puts it away, and
	// tapping the figure brings it back.
	const pad = useFoldingPad(minor !== null);
	const line = useAmountLine({
		currency,
		text: draft,
		entered,
		allowZero: true,
		label: t("amount"),
		onPress: () => pad.setPadOpen(true),
	});
	// A pick other than the saved type values the account from today on.
	const switching = rateType !== null && rateType !== saved;
	const bodyKey =
		minor === null
			? null
			: JSON.stringify({
					minor,
					id: account.id,
					rateType: switching ? rateType : null,
				});
	const { idFor, reset } = useWriteIds(bodyKey);
	const { setPadOpen } = pad;
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty and fresh
	useEffect(() => {
		if (!visible) return;
		setDraft("");
		setRateType(saved);
		setPadOpen(true);
		reset();
	}, [visible]);
	const input =
		minor === null
			? null
			: {
					id: account.id,
					balance: wireAmount(minor, currency),
					...(switching ? { rateType } : {}),
				};

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
	const same = rows ? isUnchanged(rows) && !switching : false;
	const ready = flow.status === "ready" && !same;

	// The dated note under the chips: what the pick does and what it leaves.
	// Only a pick has one; the type it already sits on needs no sentence.
	const rateNote =
		rateType === null || types.length < 2 || !switching
			? null
			: rateTypeChanged(saved, rateType)
				? t("rateChange", {
						next: rateName(rateType),
						before: rateName(saved ?? ""),
					})
				: t("rateFromToday", { next: rateName(rateType) });

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
			detents={UPDATE_BALANCE_DETENTS}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<View style={body}>
				<KeypadForm
					add={{
						onPress: submit,
						label: t("add"),
						description: t("submit"),
						folded: t("submit"),
						off: !ready,
						busy: flow.committing,
					}}
					amount={
						<AmountEntry
							currency={currency}
							error={entered.state === "invalid"}
							line={line}
							onFocusChange={pad.setTyping}
							onPress={() => pad.setPadOpen(true)}
							onText={setDraft}
							padOpen={pad.padOpen}
							system={pad.system}
							text={draft}
							typing={pad.typing}
						/>
					}
					head={
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space[3],
							}}
						>
							<IconTile name={glyphOf(account.type)} />
							<View style={{ flex: 1, minWidth: 0 }}>
								<Text numberOfLines={1} weight="semibold">
									{account.name}
								</Text>
								<Text numberOfLines={1} tone="fg3" variant="meta">
									{t("now", {
										amount: money(account.balance),
										date: format.dateTime(new Date(account.updatedAt), {
											month: "short",
											day: "numeric",
										}),
									})}
								</Text>
							</View>
						</View>
					}
					keypad={{
						text: draft,
						currency,
						kind: "money",
						onChange: setDraft,
					}}
					keypadOpen={pad.padOpen}
					onScrollDrag={() => {
						if (pad.system) pad.setPadOpen(false);
					}}
					typing={pad.typing}
				>
					<RateTypeChips
						onChange={(next) => {
							// The keypad gives way to what the pick changes.
							setRateType(next);
							pad.fold();
						}}
						types={types}
						value={rateType}
					/>
					{rateNote ? (
						<Text tone="attention" variant="small">
							{rateNote}
						</Text>
					) : null}
					{same ? (
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
					)}
					{flow.commitFailed ? (
						<Note tone="attention">{t("error")}</Note>
					) : null}
				</KeypadForm>
			</View>
		</Sheet>
	);
}
