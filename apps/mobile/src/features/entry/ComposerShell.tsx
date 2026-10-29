import { type ReactNode, useState } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	View,
} from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { amountMinor } from "./draft";

export type EntryMode = "expense" | "income" | "transfer";

/**
 * The composer's frame, the same on the iPhone tab, the iPad form sheet and
 * the Android bottom sheet: the fields scroll, while the amount, the Add
 * button and the keypad stay in the thumb zone below them. While a text
 * field is being typed in, the keypad steps aside for the system keyboard.
 */
export function ComposerShell({
	mode,
	modes,
	onModeChange,
	currencyLocked,
	amountText,
	currency,
	currencies,
	yourCurrencies,
	recentCurrencies,
	onCurrencyChange,
	onAmountChange,
	onAdd,
	addLabel,
	addDescription,
	busy,
	blocked,
	typing,
	amountError,
	surface,
	onKeypadRequest,
	rate,
	children,
}: {
	/** Under the amount: its exchange rate and its value at home, for another currency. */
	rate?: ReactNode;
	mode: EntryMode;
	/** The modes to pick between; fewer than two hides the row (an edit). */
	modes: EntryMode[];
	onModeChange: (mode: EntryMode) => void;
	/** The currency comes from an account, so it is shown and not picked. */
	currencyLocked?: boolean;
	amountText: string;
	currency: string;
	currencies: string[];
	/** Home and default currency: first in the picker. */
	yourCurrencies: string[];
	recentCurrencies: string[];
	onCurrencyChange: (currency: string) => void;
	onAmountChange: (text: string) => void;
	onAdd: () => void;
	addLabel: string;
	/** What a screen reader says for the Add button: "Add expense". */
	addDescription: string;
	busy: boolean;
	/** The dry run of what Add would send is not in yet, or was refused. */
	blocked: boolean;
	typing: boolean;
	amountError: boolean;
	/** On a sheet: the sheet's own surface, with no panel of the page's color. */
	surface?: boolean;
	/** The amount was touched: stop typing in the text field. */
	onKeypadRequest: () => void;
	children: ReactNode;
}) {
	const t = useTranslations("mobile.composer");
	const locale = useMoneyLocale();
	const { format } = useFormatMoney();
	const { color, radius, size, space } = useTheme();
	// Scrolling the fields folds the keypad away so the split and what changes
	// show in full; touching the amount brings it back.
	const [padOpen, setPadOpen] = useState(true);
	const minor = amountMinor(amountText, locale, currency);
	const spoken = minor
		? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
		: t("amountEmpty", { currency });
	const idle = busy || blocked;

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			style={{
				flex: 1,
				backgroundColor: surface ? undefined : color.bg,
			}}
		>
			<ScrollView
				contentContainerStyle={{ padding: space[4], gap: space[4] }}
				keyboardShouldPersistTaps="handled"
				onScrollBeginDrag={() => setPadOpen(false)}
				style={{ flex: 1 }}
			>
				{/* The M3 segmented button draws its outline past its box. */}
				{modes.length > 1 ? (
					<View style={{ paddingVertical: space[1] }}>
						<Segmented
							accessibilityLabel={t("mode")}
							onChange={onModeChange}
							options={modes.map((value) => ({
								value,
								label: t(value === "transfer" ? "transferMode" : value),
							}))}
							value={mode}
						/>
					</View>
				) : null}
				{children}
			</ScrollView>
			<View
				style={{
					gap: space[2],
					paddingHorizontal: space[4],
					paddingTop: space[2],
					paddingBottom: space[2],
					borderTopWidth: 1,
					borderTopColor: color.line,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space[3],
						minHeight: size.moneyInput.phone,
					}}
				>
					{currencyLocked ? (
						<Text tone="fg2" weight="semibold">
							{currency}
						</Text>
					) : (
						<CurrencyPicker
							currencies={currencies}
							onChange={onCurrencyChange}
							recent={recentCurrencies}
							value={currency}
							yours={yourCurrencies}
						/>
					)}
					<Pressable
						accessibilityHint={padOpen ? undefined : t("showKeypad")}
						accessibilityLabel={spoken}
						accessibilityRole="button"
						onPress={() => {
							Keyboard.dismiss();
							onKeypadRequest();
							setPadOpen(true);
						}}
						style={{ flex: 1 }}
					>
						<Text
							accessibilityLiveRegion="polite"
							adjustsFontSizeToFit
							numberOfLines={1}
							style={{ textAlign: "right" }}
							tone={amountText ? "fg" : "fg3"}
							variant="hero"
						>
							{amountText || "0"}
						</Text>
					</Pressable>
					<Pressable
						accessibilityLabel={addDescription}
						accessibilityRole="button"
						accessibilityState={{ busy, disabled: idle }}
						disabled={idle}
						onPress={onAdd}
						style={({ pressed }) => ({
							minHeight: size.touchMin.phone,
							justifyContent: "center",
							paddingHorizontal: space[4],
							borderRadius: radius.ctl,
							backgroundColor: pressed ? color.brandHover : color.brand,
							opacity: idle ? 0.6 : 1,
						})}
					>
						<Text style={{ color: color.brandFg }} weight="semibold">
							{addLabel}
						</Text>
					</Pressable>
				</View>
				{rate}
				{amountError ? (
					<Text
						accessibilityRole="alert"
						style={{ textAlign: "right" }}
						tone="danger"
						variant="small"
					>
						{t("errors.amount")}
					</Text>
				) : null}
				{typing || !padOpen ? null : (
					<MoneyKeypad
						currency={currency}
						draft={amountText}
						keyHeight={size.touchMin.phone}
						onDraftChange={onAmountChange}
					/>
				)}
			</View>
		</KeyboardAvoidingView>
	);
}
