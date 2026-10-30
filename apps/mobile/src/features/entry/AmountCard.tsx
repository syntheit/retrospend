import type { ReactNode } from "react";
import { useRef } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { FixedCurrency } from "@/ui/AmountField";
import { CurrencyPicker } from "@/ui/CurrencyPicker";
import { Text, typeStyle } from "@/ui/Text";
import { currencyChoices } from "./currencyChoices";
import { amountMinor, DEFAULT_RATE } from "./draft";
import type { EntryForm } from "./useEntryForm";

/** One amount the keypad can type: its currency, what is typed, and how it is spoken. */
export interface MoneyLine {
	key: "amount" | "received";
	/** A picker, or the plain code when the currency comes from an account. */
	currency: ReactNode;
	text: string;
	placeholder: string;
	/** What a screen reader says: "Amount, ARS 12,500". */
	spoken: string;
	/** The keypad types into this one. */
	active: boolean;
	onPress: () => void;
}

/** The typed amount scales with the text size up to here, so a figure fits its card. */
const SYSTEM_AMOUNT_SCALE = 1.5;

/**
 * How the card is typed into on the system decimal keyboard, at the largest
 * text sizes where the keypad does not fit. The active amount becomes a text
 * input; the composer formats what comes back.
 */
export interface SystemEntry {
	onChangeText: (raw: string) => void;
	onFocusChange: (focused: boolean) => void;
	/** Open the keyboard as the card appears. */
	autoFocus: boolean;
}

/**
 * The amount: a surface card holding one money row per amount (a transfer
 * between currencies has two), each with its currency at the start and the
 * number at 22/500, right-aligned with tabular figures. The card takes a
 * brand ring while the keypad is up and a danger ring while the amount is
 * wrong. `foreign` is the rate line under the amount, for another currency.
 */
export function AmountCard({
	lines,
	ring,
	foreign,
	system,
}: {
	lines: MoneyLine[];
	ring: "idle" | "focus" | "error";
	foreign?: ReactNode;
	system?: SystemEntry;
}) {
	const theme = useTheme();
	const { color, radius, size, space } = theme;
	const inputs = useRef<Record<string, TextInput | null>>({});
	const edge = space[1] / 2;
	const many = lines.length > 1;
	// A resting card is a line-strong hairline, so it reads on the sheet's
	// surface; the ring is thicker and padded back so nothing moves.
	const ringColor =
		ring === "error"
			? color.danger
			: ring === "focus"
				? color.brand
				: color.lineStrong;
	const cardEdge = many || ring === "idle" ? 1 : edge;
	return (
		<View
			style={{
				backgroundColor: color.surface,
				borderRadius: radius.panel,
				borderWidth: cardEdge,
				// With two rows the active row carries the ring, so the card keeps a hairline.
				borderColor: many ? color.lineStrong : ringColor,
				paddingHorizontal: space[2] + edge - cardEdge,
				paddingVertical: (many ? space[1] : 0) + edge - cardEdge,
			}}
		>
			{lines.map((line) => (
				<View
					key={line.key}
					style={{
						minHeight: size.touchMin.phone + space[2],
						flexDirection: "row",
						alignItems: "center",
						gap: space[2],
						borderRadius: radius.ctl,
						borderWidth: many ? edge : 0,
						borderColor:
							many && line.active
								? ring === "error"
									? color.danger
									: color.brand
								: "transparent",
						paddingHorizontal: many ? space[2] : 0,
					}}
				>
					{line.currency}
					{system ? (
						<Pressable
							onPress={() => {
								if (!line.active) line.onPress();
								// The target changes first, then the keyboard opens on it.
								setTimeout(() => inputs.current[line.key]?.focus(), 0);
							}}
							style={{ flex: 1, minHeight: size.touchMin.phone }}
						>
							<TextInput
								accessibilityLabel={line.spoken}
								autoComplete="off"
								autoCorrect={false}
								autoFocus={system.autoFocus && line.active}
								editable={line.active}
								inputMode="decimal"
								keyboardType="decimal-pad"
								maxFontSizeMultiplier={SYSTEM_AMOUNT_SCALE}
								onBlur={() => system.onFocusChange(false)}
								onChangeText={system.onChangeText}
								onFocus={() => system.onFocusChange(true)}
								placeholder={line.placeholder}
								placeholderTextColor={color.fg3}
								ref={(node) => {
									inputs.current[line.key] = node;
								}}
								selectionColor={color.brand}
								style={[
									typeStyle(theme, "title", { weight: "medium", tabular: true }),
									{
										flex: 1,
										minHeight: size.touchMin.phone,
										paddingRight: space[2],
										textAlign: "right",
										color: color.fg,
									},
								]}
								value={line.text}
							/>
						</Pressable>
					) : (
						<Pressable
							accessibilityLabel={line.spoken}
							accessibilityRole="button"
							onPress={line.onPress}
							style={{
								flex: 1,
								minHeight: size.touchMin.phone,
								justifyContent: "center",
							}}
						>
							<Text
								accessibilityLiveRegion="polite"
								adjustsFontSizeToFit
								numberOfLines={1}
								style={{
									paddingRight: space[2],
									textAlign: "right",
								}}
								tabular
								tone={line.text ? "fg" : "fg3"}
								variant="title"
								weight="medium"
							>
								{line.text || line.placeholder}
							</Text>
						</Pressable>
					)}
				</View>
			))}
			{foreign ? (
				<View style={{ paddingBottom: space[2], paddingHorizontal: space[2] }}>
					{foreign}
				</View>
			) : null}
		</View>
	);
}

/**
 * The money rows for the open mode: an expense and an income have one, with
 * the currency picker; a transfer has the one it sends (its account's
 * currency, shown not picked) and, between currencies, the one that arrives.
 */
export function useMoneyLines(form: EntryForm): MoneyLine[] {
	const t = useTranslations("mobile.composer");
	const { format } = useFormatMoney();
	const { catalog, mode, locale } = form;
	const spokenOf = (text: string, currency: string) => {
		const minor = amountMinor(text, locale, currency);
		return minor
			? t("amountLabel", { amount: format({ minor, currency }) ?? "" })
			: t("amountEmpty", { currency });
	};
	const code = (currency: string) => <FixedCurrency code={currency} />;
	if (mode === "transfer") {
		const out: MoneyLine = {
			key: "amount",
			currency: code(form.fromCurrency),
			text: form.transfer.amountText,
			placeholder: "0",
			spoken: spokenOf(form.transfer.amountText, form.fromCurrency),
			active: form.target === "amount",
			onPress: () => {
				form.setTarget("amount");
				form.requestKeypad();
			},
		};
		if (!form.exchange || !form.toCurrency) return [out];
		const receivedMinor = amountMinor(
			form.transfer.receivedText,
			locale,
			form.toCurrency,
		);
		return [
			out,
			{
				key: "received",
				currency: code(form.toCurrency),
				text: form.transfer.receivedText,
				placeholder: t("transfer.receivedPlaceholder"),
				spoken: receivedMinor
					? t("transfer.receivedLabel", {
							amount:
								format({ minor: receivedMinor, currency: form.toCurrency }) ??
								"",
						})
					: t("transfer.receivedEmpty", { currency: form.toCurrency }),
				active: form.target === "received",
				onPress: () => {
					form.setTarget("received");
					form.requestKeypad();
				},
			},
		];
	}
	const draft = mode === "income" ? form.income : form.expense;
	const choices = currencyChoices(catalog, form.me, draft.currency);
	const locked =
		form.expense.editing?.source === "shared" && mode === "expense";
	return [
		{
			key: "amount",
			currency: locked ? (
				code(draft.currency)
			) : (
				<CurrencyPicker
					currencies={choices.currencies}
					onChange={(currency) =>
						mode === "income"
							? form.patchIncome({ currency, amountText: "", ...DEFAULT_RATE })
							: form.patchExpense({ currency, amountText: "", ...DEFAULT_RATE })
					}
					recent={choices.recent}
					value={draft.currency}
					yours={choices.yours}
				/>
			),
			text: draft.amountText,
			placeholder: "0",
			spoken: spokenOf(draft.amountText, draft.currency),
			active: true,
			onPress: form.requestKeypad,
		},
	];
}
