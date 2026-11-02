import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslations } from "use-intl";
import { type Entered, minorOf } from "@/features/write/amount";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { CurrencyFlag } from "./CurrencyFlag";
import { CurrencyPicker } from "./CurrencyPicker";
import { applyKey } from "./keypad";
import { MoneyKeypad } from "./MoneyKeypad";
import { HAIRLINE } from "./metrics";
import { OperatorKeys } from "./OperatorKeys";
import { Text } from "./Text";
import { FieldLabel } from "./TextField";

/**
 * A currency that cannot be changed here: its flag and its code as plain
 * fg-2 text, never a bordered chip that looks tappable. The one look for a
 * fixed currency in the amount field and in the composer's amount card.
 */
export function FixedCurrency({ code }: { code: string }) {
	const { space } = useTheme();
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
			<CurrencyFlag code={code} small />
			<Text tone="fg2" weight="semibold">
				{code}
			</Text>
		</View>
	);
}

/** What the person may pick when the form lets the currency change. */
export interface CurrencyChoice {
	currencies: string[];
	/** Home and default currency, after the pinned ones. */
	yours?: string[];
	/** Used lately, newest first. */
	recent?: string[];
	onChange: (code: string) => void;
}

/**
 * The one money input for a single amount in a sheet (R22): a FieldLabel
 * over a bordered 44 point box, the currency at its start and the value at
 * 16/500 on the right, never hero size, then the operator keys and the keypad
 * (44 point keys). The currency is the picker when the form lets it change
 * (`choose`), or its flag and code as plain text when it is fixed. The text
 * is the keypad's (formatted by the domain package); the sheet reads it with
 * `readAmount`. The spoken label carries the amount as money, like the
 * composer's.
 */
export function AmountField({
	currency,
	draft,
	onDraftChange,
	entered,
	label,
	hideLabel,
	allowZero,
	placeholder,
	between,
	choose,
	operators = true,
	keypad = true,
	onPress,
}: {
	currency: string;
	draft: string;
	onDraftChange: (draft: string) => void;
	entered: Entered;
	/** What the amount is ("Amount", "If you spend"): shown over the field and spoken. */
	label: string;
	/** The sheet already says it; screen readers still get the label. */
	hideLabel?: boolean;
	allowZero?: boolean;
	placeholder?: string;
	/** What reads straight after the input, before the keypad (rate chips, a preview). */
	between?: ReactNode;
	/** The currency can be picked here. */
	choose?: CurrencyChoice;
	/** The + - × ÷ keys over the keypad. On unless the amount is never a sum. */
	operators?: boolean;
	/** The keypad is up. A sheet with two amounts shows it under the one being typed. */
	keypad?: boolean;
	/** Tapping the amount (brings the keypad back). */
	onPress?: () => void;
}) {
	const t = useTranslations("mobile.composer");
	const tm = useTranslations("mobile.money");
	const { format } = useFormatMoney();
	const locale = useMoneyLocale();
	const { color, radius, size, space } = useTheme();
	const minor = minorOf(entered, allowZero);
	const invalid = entered.state === "invalid";
	const spoken =
		minor !== null
			? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: t("amountEmpty", { currency });
	const said = `${label}, ${spoken}`;
	const value = (
		<Text
			accessibilityLabel={onPress ? undefined : said}
			accessibilityLiveRegion="polite"
			adjustsFontSizeToFit
			numberOfLines={1}
			style={{ paddingRight: space[2], textAlign: "right" }}
			tabular
			tone={draft ? "fg" : "fg3"}
			variant="section"
			weight="medium"
		>
			{draft || placeholder || "0"}
		</Text>
	);
	return (
		<View style={{ gap: space[4] }}>
			<View style={{ gap: space[1] }}>
				{hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space[2],
						minHeight: size.moneyInput.phone,
						paddingHorizontal: space[1],
						backgroundColor: color.surface,
						borderWidth: HAIRLINE,
						borderColor: invalid ? color.danger : color.lineStrong,
						borderRadius: radius.ctl,
					}}
				>
					{choose ? (
						<CurrencyPicker
							currencies={choose.currencies}
							onChange={choose.onChange}
							recent={choose.recent}
							value={currency}
							yours={choose.yours}
						/>
					) : (
						<View
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
							style={{ paddingHorizontal: space[2] }}
						>
							<FixedCurrency code={currency} />
						</View>
					)}
					<View style={{ flex: 1 }}>
						{onPress ? (
							<Pressable
								accessibilityLabel={said}
								accessibilityRole="button"
								onPress={onPress}
								style={{
									minHeight: size.touchMin.phone,
									justifyContent: "center",
								}}
							>
								{value}
							</Pressable>
						) : (
							value
						)}
					</View>
				</View>
				{invalid ? (
					<Text
						accessibilityRole="alert"
						style={{ textAlign: "right" }}
						tone="danger"
						variant="small"
					>
						{tm("invalid")}
					</Text>
				) : null}
			</View>
			{between}
			{keypad ? (
				<View style={{ gap: space[2] }}>
					{operators ? (
						<OperatorKeys
							onOperator={(sign) =>
								onDraftChange(applyKey(draft, sign, locale, currency))
							}
						/>
					) : null}
					<MoneyKeypad
						compact
						currency={currency}
						draft={draft}
						onDraftChange={onDraftChange}
					/>
				</View>
			) : null}
		</View>
	);
}
