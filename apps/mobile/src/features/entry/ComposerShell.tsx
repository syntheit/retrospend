import { type ReactNode, useState } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useTranslations } from "use-intl";
import { useFormatLocale } from "@/lib/intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import { MoneyKeypad } from "@/ui/MoneyKeypad";
import { Segmented } from "@/ui/Segmented";
import { amountMinor } from "./draft";

export type EntryMode = "expense" | "income";

/**
 * The composer's frame, the same on the iPhone tab, the iPad form sheet and
 * the Android bottom sheet: the fields scroll, while the amount, the Add
 * button and the keypad stay in the thumb zone below them. While a text
 * field is being typed in, the keypad steps aside for the system keyboard.
 */
export function ComposerShell({
	mode,
	onModeChange,
	amountText,
	currency,
	currencies,
	onCurrencyChange,
	onAmountChange,
	onAdd,
	addLabel,
	addDescription,
	busy,
	typing,
	amountError,
	bottomInset = 0,
	onKeypadRequest,
	children,
}: {
	mode: EntryMode;
	onModeChange: (mode: EntryMode) => void;
	amountText: string;
	currency: string;
	currencies: string[];
	onCurrencyChange: (currency: string) => void;
	onAmountChange: (text: string) => void;
	onAdd: () => void;
	addLabel: string;
	/** What a screen reader says for the Add button: "Add expense". */
	addDescription: string;
	busy: boolean;
	typing: boolean;
	amountError: boolean;
	/** Room for a bar that floats over the screen, like the iPhone tab bar. */
	bottomInset?: number;
	/** The amount was touched: stop typing in the text field. */
	onKeypadRequest: () => void;
	children: ReactNode;
}) {
	const t = useTranslations("mobile.entry");
	const locale = useFormatLocale();
	const { format } = useFormatMoney();
	const { color, radius, size, space, type } = useTheme();
	// Scrolling the fields folds the keypad away so the split and what changes
	// show in full; touching the amount brings it back.
	const [padOpen, setPadOpen] = useState(true);
	const minor = amountMinor(amountText, locale, currency);
	const spoken = minor
		? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
		: t("amountEmpty", { currency });

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === "ios" ? "padding" : undefined}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			<ScrollView
				contentContainerStyle={{ padding: space[4], gap: space[4] }}
				keyboardShouldPersistTaps="handled"
				onScrollBeginDrag={() => setPadOpen(false)}
				style={{ flex: 1 }}
			>
				<Segmented
					accessibilityLabel={t("mode")}
					onChange={onModeChange}
					options={[
						{ value: "expense", label: t("expense") },
						{ value: "income", label: t("income") },
					]}
					value={mode}
				/>
				{children}
			</ScrollView>
			<View
				style={{
					gap: space[2],
					paddingHorizontal: space[4],
					paddingTop: space[2],
					paddingBottom: space[2] + bottomInset,
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
					<Menu
						items={currencies.map((code) => ({
							id: code,
							label: code,
							onPress: () => onCurrencyChange(code),
						}))}
						label={currency}
					/>
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
							style={{
								color: amountText ? color.fg : color.fg3,
								fontSize: type.hero.size,
								fontVariant: ["tabular-nums"],
								fontWeight: "600",
								textAlign: "right",
							}}
						>
							{amountText || "0"}
						</Text>
					</Pressable>
					<Pressable
						accessibilityLabel={addDescription}
						accessibilityRole="button"
						accessibilityState={{ busy, disabled: busy }}
						disabled={busy}
						onPress={onAdd}
						style={({ pressed }) => ({
							minHeight: size.touchMin.phone,
							justifyContent: "center",
							paddingHorizontal: space[4],
							borderRadius: radius.ctl,
							backgroundColor: pressed ? color.brandHover : color.brand,
							opacity: busy ? 0.6 : 1,
						})}
					>
						<Text
							style={{
								color: color.brandFg,
								fontSize: type.body.size,
								fontWeight: "600",
							}}
						>
							{addLabel}
						</Text>
					</Pressable>
				</View>
				{amountError ? (
					<Text
						accessibilityRole="alert"
						style={{
							color: color.danger,
							fontSize: type.small.size,
							textAlign: "right",
						}}
					>
						{t("errors.amount")}
					</Text>
				) : null}
				{typing || !padOpen ? null : (
					<MoneyKeypad
						currency={currency}
						keyHeight={size.touchMin.phone}
						draft={amountText}
						onDraftChange={onAmountChange}
					/>
				)}
			</View>
		</KeyboardAvoidingView>
	);
}
