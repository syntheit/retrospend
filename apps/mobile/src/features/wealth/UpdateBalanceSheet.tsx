import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useRateLine } from "@/features/currencies/useRateLine";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount, wireAmount } from "@/features/write/amount";
import { figureLines } from "@/features/write/figures";
import { Note, SheetBody, useAmountLocale } from "@/features/write/parts";
import { useFigureLabel } from "@/features/write/useFigureLabel";
import { useMoneyWrite, useWriteIds } from "@/features/write/useMoneyWrite";
import { useUndoToast } from "@/features/write/useUndoToast";
import { noSession, useApi } from "@/features/write/WriteFrame";
import { useRateFormat } from "@/lib/rateFormat";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { Button } from "@/ui/Button";
import { ChangeList, type ChangeRow } from "@/ui/ChangeList";
import { IconTile } from "@/ui/IconTile";
import { useRateTypeLabel } from "@/ui/Money";
import { Sheet, type SheetDetent } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { glyphOf } from "./accounts";
import { ACCOUNT_BALANCE, balanceRows, isUnchanged } from "./balance";
import { RateTypeChips } from "./RateTypeChips";
import { rateTypeChanged, rateTypesOf } from "./rateType";
import type { Account, CurrencyInfo } from "./source";

/**
 * Update balance rests at large only. Its body is the account, the amount, the
 * operator keys and the whole keypad; at medium (half the window) the keypad
 * stopped after 4 5 6 and 7 8 9 0 needed a drag up before a balance could be
 * typed. At large the whole keypad and the Update balance footer are in view.
 */
export const UPDATE_BALANCE_DETENTS: SheetDetent[] = ["large"];

/**
 * Say what the account holds today. In the order the mockup sets: the account
 * and what it shows now, the new balance, the keypad, the rate type it is valued at
 * from today (earlier days keep theirs), What this changes, and the verb
 * pinned under them. The amount and keypad come first so they are in view at
 * the detent it rests at. The server works out the difference and records it
 * as Not logged (not income, not spending); the dry run shows the account's
 * new balance, net worth and that difference before Update is on. The toast
 * undoes it.
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
	const common = useTranslations("mobile.common");
	const tp = useTranslations("mobile.budget.preview");
	const format = useFormatter();
	const api = useApi();
	const announce = useUndoToast("accounts");
	const money = useMoneyText();
	const rateName = useRateTypeLabel();
	const locale = useAmountLocale();
	const { space } = useTheme();
	const currency = account.balance.currency;
	const types = rateTypesOf(catalog, currency, home);
	const rateLine = useRateLine(visible && types.length > 1);
	const rateFmt = useRateFormat();
	const saved = account.rateType;
	const [draft, setDraft] = useState("");
	const [rateType, setRateType] = useState<string | null>(saved);
	// The keypad is up on opening; picking a rate type puts it away, and
	// tapping the amount brings it back.
	const [keypad, setKeypad] = useState(true);
	const entered = readAmount(draft, locale, currency);
	// Zero is a real balance: an empty account, a paid-off card.
	const minor = minorOf(entered, true);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: each opening starts empty and fresh
	useEffect(() => {
		if (!visible) return;
		setDraft("");
		setRateType(saved);
		setKeypad(true);
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

	// A type is named with its number (R8). The saved type's own rate is on the
	// account, so it has its number before the table answers.
	const named = (type: string) =>
		rateLine(currency, type) ??
		(type === saved && account.value
			? rateFmt.typed(
					rateName(type),
					currency,
					account.value.currency,
					account.rate,
				)
			: null) ??
		rateName(type);
	// The dated note under the chips: what the pick does and what it leaves.
	const rateNote =
		rateType === null || types.length < 2
			? null
			: !switching
				? t("valuedAt", { type: named(rateType) })
				: rateTypeChanged(saved, rateType)
					? t("rateChange", {
							next: named(rateType),
							before: saved ? named(saved) : "",
						})
					: t("rateFromToday", { next: named(rateType) });

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
			footer={
				<>
					{Platform.OS === "android" ? (
						<Button label={common("cancel")} onPress={onClose} variant="text" />
					) : null}
					<Button
						disabled={!ready || flow.committing}
						label={flow.committing ? common("saving") : t("submit")}
						onPress={submit}
					/>
				</>
			}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<SheetBody>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
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
				<View style={{ gap: space[4] }}>
					<AmountField
						allowZero
						currency={currency}
						draft={draft}
						entered={entered}
						keypad={keypad}
						label={t("amount")}
						onDraftChange={setDraft}
						onPress={() => setKeypad(true)}
					/>
					<View style={{ gap: space[4] }}>
						<RateTypeChips
							onChange={(next) => {
								// The keypad gives way to what the pick changes.
								setRateType(next);
								setKeypad(false);
							}}
							types={types}
							value={rateType}
						/>
						{rateNote ? (
							<Text tone={switching ? "attention" : "fg2"} variant="small">
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
					</View>
				</View>
			</SheetBody>
		</Sheet>
	);
}
