import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { minorOf, readAmount } from "@/features/write/amount";
import { Note, useAmountLocale } from "@/features/write/parts";
import { useTheme } from "@/theme";
import { AmountField } from "@/ui/AmountField";
import { ChipGroup } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";
import { ChoiceList } from "./fields";
import {
	ANSWERS,
	METHODS,
	type PayAnswer,
	type PayFrequency,
	presetMinor,
	type SetupChoice,
	type SetupDraft,
	type SetupPreset,
} from "./setupBody";

const FREQUENCIES: PayFrequency[] = [
	"MONTHLY",
	"EVERY_TWO_WEEKS",
	"WEEKLY",
	"VARIES",
];

function Heading({ title, sub }: { title: string; sub?: string }) {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[1] }}>
			<Text accessibilityRole="header" variant="section">
				{title}
			</Text>
			{sub ? <Note>{sub}</Note> : null}
		</View>
	);
}

/** "How do you like to budget?": the answers, then the methods. Nothing is written until the last step. */
export function StyleStep({
	value,
	onChange,
}: {
	value: SetupChoice;
	onChange: (choice: SetupChoice) => void;
}) {
	const t = useTranslations("mobile.budget.setup");
	const ts = useTranslations("mobile.budget.style");
	const { space } = useTheme();
	const options = (list: SetupChoice[]) =>
		list.map((c) => ({
			value: c,
			label: c === "TRACK" ? t("track") : ts(`name.${c}`),
		}));
	return (
		<View style={{ gap: space[4] }}>
			<Heading title={t("styleTitle")} />
			<ChipGroup
				accessibilityLabel={t("styleTitle")}
				onChange={onChange}
				options={options(ANSWERS)}
				value={value}
			/>
			<ChipGroup
				accessibilityLabel={t("methods")}
				label={t("methods")}
				onChange={onChange}
				options={options(METHODS)}
				value={value}
			/>
			<Note>{value === "TRACK" ? t("trackAbout") : ts(`about.${value}`)}</Note>
		</View>
	);
}

/** "How do you get paid?": how often, and the next pay when the cycle has a date. */
export function PayStep({
	value,
	today,
	onChange,
}: {
	value: PayAnswer;
	today: string;
	onChange: (value: PayAnswer) => void;
}) {
	const t = useTranslations("mobile.budget.setup.pay");
	const { space } = useTheme();
	const dated = value.frequency !== null && value.frequency !== "VARIES";
	return (
		<View style={{ gap: space[4] }}>
			<Heading sub={t("sub")} title={t("title")} />
			<ChipGroup
				accessibilityLabel={t("frequency")}
				label={t("frequency")}
				onChange={(frequency) => onChange({ ...value, frequency })}
				options={FREQUENCIES.map((f) => ({ value: f, label: t(f) }))}
				value={value.frequency}
			/>
			{dated ? (
				<>
					<DateField
						label={t("next")}
						onChange={(next) => onChange({ ...value, next })}
						value={value.next}
					/>
					{value.next !== "" && value.next < today ? (
						<Note tone="attention">{t("past")}</Note>
					) : null}
				</>
			) : null}
		</View>
	);
}

/** "How much money can you budget right now?" Not asked for Limits. */
export function MoneyStep({
	currency,
	draft,
	onDraft,
}: {
	currency: string;
	draft: string;
	onDraft: (text: string) => void;
}) {
	const t = useTranslations("mobile.budget.setup");
	const locale = useAmountLocale();
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			<Heading sub={t("moneySub")} title={t("moneyTitle")} />
			<AmountField
				allowZero
				currency={currency}
				draft={draft}
				entered={readAmount(draft, locale, currency)}
				label={t("haveNow")}
				onDraftChange={onDraft}
			/>
		</View>
	);
}

/**
 * Your envelopes: the style's proposal. A tap keeps or drops one (the default
 * one stays), and one amount is changed at a time on the keypad.
 */
export function EnvelopesStep({
	preset,
	draft,
	nameOf,
	onToggle,
	onAmount,
}: {
	preset: SetupPreset;
	draft: SetupDraft;
	nameOf: (nameKey: string | null, fallback: string | null) => string;
	onToggle: (key: string) => void;
	onAmount: (key: string, minor: number) => void;
}) {
	const t = useTranslations("mobile.budget.setup");
	const money = useMoneyText();
	const locale = useAmountLocale();
	const { currency } = preset;
	const { space } = useTheme();
	const [editing, setEditing] = useState<string | null>(null);
	const [text, setText] = useState("");
	const kept = preset.envelopes.filter(
		(e) => e.isDefault || !draft.off.has(e.key),
	);
	const amountOf = (key: string, minor: number | null) =>
		draft.amounts[key] ?? minor;
	const withAmount = kept.filter((e) => presetMinor(e, currency) !== null);
	const limits = draft.style === "LIMITS";

	const pick = (key: string) => {
		setEditing(key);
		setText("");
	};
	const type = (next: string) => {
		setText(next);
		const minor = minorOf(readAmount(next, locale, currency), true);
		if (editing && minor !== null) onAmount(editing, minor);
	};
	return (
		<View style={{ gap: space[4] }}>
			<Heading
				sub={t(limits ? "limitsSub" : "envelopesSub")}
				title={t(limits ? "limitsTitle" : "envelopesTitle")}
			/>
			<ChoiceList
				choices={preset.envelopes.map((e) => {
					const minor = presetMinor(e, currency);
					const now = amountOf(e.key, minor);
					return {
						id: e.key,
						label: nameOf(e.nameKey, e.name),
						detail: now === null ? undefined : money({ minor: now, currency }),
					};
				})}
				onPress={(key) => {
					const e = preset.envelopes.find((x) => x.key === key);
					if (e && !e.isDefault) onToggle(key);
				}}
				selected={new Set(kept.map((e) => e.key))}
			/>
			{withAmount.length > 0 ? (
				<>
					<ChoiceList
						choices={withAmount.map((e) => ({
							id: e.key,
							label: t("amountFor", { name: nameOf(e.nameKey, e.name) }),
						}))}
						label={t("adjust")}
						onPress={pick}
						selected={new Set(editing ? [editing] : [])}
					/>
					{editing ? (
						<AmountField
							allowZero
							currency={currency}
							draft={text}
							entered={readAmount(text, locale, currency)}
							label={t("adjust")}
							onDraftChange={type}
						/>
					) : null}
				</>
			) : null}
		</View>
	);
}

/** When the plan costs more than you start with, the way on is to say the rest comes from your pay. */
export function PlanStop({
	cost,
	available,
	short,
	covered,
	onCovered,
	nextPay,
}: {
	cost: { minor: number; currency: string };
	available: { minor: number; currency: string };
	short: { minor: number; currency: string };
	covered: boolean;
	onCovered: (value: boolean) => void;
	nextPay: string | null;
}) {
	const t = useTranslations("mobile.budget.setup");
	const money = useMoneyText();
	const { space } = useTheme();
	if (short.minor <= 0) return null;
	return (
		<View style={{ gap: space[2] }}>
			<Note tone="attention">
				{t("stop", { cost: money(cost), available: money(available) })}
			</Note>
			<SwitchRow
				detail={
					nextPay
						? t("usePayOn", { date: nextPay, short: money(short) })
						: t("usePay", { short: money(short) })
				}
				label={t("coverLabel")}
				onChange={onCovered}
				value={covered}
			/>
		</View>
	);
}
