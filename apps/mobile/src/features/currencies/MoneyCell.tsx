import {
	formatMoneyDraft,
	type MoneyInputError,
	type MoneyInputResult,
	parseMoneyInput,
} from "@retrospend/domain/parse";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { type Money, useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { HAIRLINE } from "@/ui/metrics";
import { Text, typeStyle } from "@/ui/Text";

/**
 * The error a cell shows, or null. Nothing typed is not an error, and zero is
 * left to the row (a part can be zero); a half-written sum waits for the
 * field to lose focus (`touched`) or for a Save attempt.
 */
export function cellError(
	result: MoneyInputResult,
	touched: boolean,
): MoneyInputError | null {
	if (result.ok || !touched) return null;
	return result.error === "empty" || result.error === "zero"
		? null
		: result.error;
}

/**
 * The text after one edit: grouped and cut to the currency's decimals by the
 * domain package, against the text before it so a foreign mark stays visible.
 */
export function cellEdit(
	raw: string,
	previous: string,
	locale: string,
	currency: string,
): { text: string; result: MoneyInputResult } {
	const text = formatMoneyDraft(raw, locale, currency, previous);
	return { text, result: parseMoneyInput(text, locale, currency) };
}

/**
 * MoneyCell: inline amount entry in a row, the native twin of the web's
 * MoneyCell. It reads and groups the draft like the amount field (the same
 * domain parser and draft), but has no currency chip, keypad or operator
 * row: the row and the sheet name the currency once. 44 high, right-aligned,
 * tabular figures, typed on the system decimal pad. Use AmountField for the
 * one amount a sheet asks for.
 */
export function MoneyCell({
	value,
	currency,
	label,
	onChange,
	readOnly = false,
	invalid = false,
	showErrors = false,
	showCurrency = false,
	home,
	onTypingChange,
}: {
	/** The draft text; keep it in state, like AmountField. */
	value: string;
	currency: string;
	/** The accessible name: the row says what this amount is for. */
	label: string;
	onChange: (text: string, result: MoneyInputResult) => void;
	/** The amount reads as text, aligned the same. */
	readOnly?: boolean;
	/** The server says this amount cannot be used (a limit, a missing rate). */
	invalid?: boolean;
	/** Show errors now (after a Save attempt). */
	showErrors?: boolean;
	/** A foreign amount: its ISO code leads the figure. */
	showCurrency?: boolean;
	/** The converted amount in the home currency (the server's figure), under the cell. */
	home?: Money;
	/** Told when typing starts and stops, so a screen can hide its keypad. */
	onTypingChange?: (typing: boolean) => void;
}) {
	const tm = useTranslations("mobile.money");
	const locale = useMoneyLocale();
	const { format } = useFormatMoney();
	const theme = useTheme();
	const { color, radius, size, space } = theme;
	const [touched, setTouched] = useState(false);
	const error = readOnly
		? null
		: cellError(
				parseMoneyInput(value, locale, currency),
				touched || showErrors,
			);
	const bad = invalid || error !== null;
	const homeText = home ? format(home) : null;
	return (
		<View style={{ alignItems: "flex-end", gap: space[1] }}>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
			>
				{showCurrency ? (
					<Text tone="fg3" variant="meta">
						{currency}
					</Text>
				) : null}
				<TextInput
					accessibilityLabel={label}
					autoComplete="off"
					autoCorrect={false}
					editable={!readOnly}
					inputMode="decimal"
					keyboardType="decimal-pad"
					onBlur={() => {
						setTouched(true);
						onTypingChange?.(false);
					}}
					onChangeText={(raw) => {
						const edit = cellEdit(raw, value, locale, currency);
						onChange(edit.text, edit.result);
					}}
					onFocus={() => onTypingChange?.(true)}
					placeholder="0"
					placeholderTextColor={color.fg3}
					selectionColor={color.brand}
					style={[
						typeStyle(theme, "body", { weight: "medium", tabular: true }),
						{
							minWidth: space[12] * 3,
							minHeight: size.moneyInput.phone,
							paddingHorizontal: space[3],
							textAlign: "right",
							color: color.fg,
							borderRadius: radius.ctl,
							...(readOnly
								? null
								: {
										borderWidth: HAIRLINE,
										borderColor: bad ? color.danger : color.lineStrong,
										backgroundColor: color.surface,
									}),
						},
					]}
					value={value}
				/>
			</View>
			{error ? (
				<Text accessibilityRole="alert" tone="danger" variant="meta">
					{tm("invalid")}
				</Text>
			) : null}
			{homeText ? (
				<Text tabular tone="fg3" variant="meta">
					{homeText}
				</Text>
			) : null}
		</View>
	);
}
