import {
	rateDirection,
	storedRateToTyped,
} from "@retrospend/domain/rate-format";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useRateFormat } from "@/lib/rateFormat";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { PickerSheet } from "@/ui/PickerSheet";
import { Text } from "@/ui/Text";
import { FieldError, TextField } from "@/ui/TextField";
import type { RateChoice } from "./draft";
import type { RateOptions } from "./hooks";
import { rateView } from "./rate";

/** The picker row that switches to a typed rate. */
const CUSTOM = "\u0000custom";

/**
 * The exchange rate of an amount in another currency, under the amount in
 * the composer's thumb zone (GUIDELINE 7): the rate type as a button that
 * opens every type the pair offers with its rate, Custom last, and the
 * amount at home as the server books it, muted below the original. A pair
 * with no rate says so and offers Enter rate; it never converts at 1. A
 * split expense books at your default type, so the type is stated there,
 * not picked.
 */
export function RateField({
	options,
	choice,
	currency,
	homeCurrency,
	shared,
	keptHome,
	error,
	onChange,
	onTypingChange,
}: {
	options: RateOptions | null;
	choice: RateChoice;
	currency: string;
	homeCurrency: string;
	shared: boolean;
	/** A saved expense's home value, while its saved custom rate is kept. */
	keptHome: { minor: number; currency: string } | null;
	/** Save was pressed with a typed rate that does not read as one. */
	error: boolean;
	onChange: (patch: Partial<RateChoice>) => void;
	onTypingChange: (typing: boolean) => void;
}) {
	const t = useTranslations("mobile.composer.rate");
	const tp = useTranslations("mobile.pickers");
	const name = useRateTypeName();
	const { format } = useFormatMoney();
	const fmt = useRateFormat();
	const { space } = useTheme();
	const [open, setOpen] = useState(false);
	const view = rateView(options, choice, keptHome);
	const locale = useMoneyLocale();
	// The pair reads the way its rate reads: the typed number is the >= 1 one,
	// whatever way the rate is stored (the table decides, a saved rate backs it).
	const dir = rateDirection(
		currency,
		homeCurrency,
		options?.options[0]?.rate.rate ?? choice.savedRate,
	);
	// Custom starts from the saved custom rate, read the way it reads now.
	const startCustom = (): Partial<RateChoice> => ({
		custom: true,
		customFlipped: dir.flipped,
		...(choice.customText === "" && choice.savedRate
			? { customText: storedRateToTyped(choice.savedRate, dir.flipped, locale) }
			: {}),
	});
	// Offline before the first answer: nothing to pick from or show yet.
	if (!options && !choice.custom && !view.home) return null;
	// A type never shows without its number: "Blue · 1 USD = 1,545.20 ARS" (R8).
	const typeName = view.picked
		? fmt.withType(name(view.type), view.picked.rate)
		: null;
	// While a custom rate is being typed there is no number yet: the trigger still leaves Custom.
	const triggerText = typeName ?? (choice.custom ? name("custom") : null);
	const home = view.home ? format(view.home) : null;

	return (
		<View style={{ gap: space[2] }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[3],
				}}
			>
				{shared ? (
					typeName ? (
						<Text
							accessibilityHint={t("sharedFixed")}
							style={{ flexShrink: 1 }}
							tone="fg2"
							variant="small"
						>
							{t("fixed", { type: typeName })}
						</Text>
					) : null
				) : view.missing ? (
					<>
						<Text
							accessibilityRole="alert"
							style={{ flexShrink: 1 }}
							tone="attention"
							variant="small"
						>
							{t("missing", { currency })}
						</Text>
						<Button
							label={t("enterRate")}
							onPress={() => onChange(startCustom())}
							variant="text"
						/>
					</>
				) : triggerText ? (
					<Button
						accessibilityLabel={t("triggerLabel", { type: triggerText })}
						label={triggerText}
						onPress={() => setOpen(true)}
						variant="text"
					/>
				) : null}
				<View style={{ flex: 1 }} />
				{home ? (
					<Text
						accessibilityLabel={t("homeLabel", { amount: home })}
						numberOfLines={1}
						style={{ textAlign: "right" }}
						tabular
						tone="fg2"
					>
						{home}
					</Text>
				) : null}
			</View>
			{choice.custom && !shared ? (
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Text tone="fg2">{t("customUnit", { currency: dir.base })}</Text>
					<View style={{ flex: 1 }}>
						<TextField
							hideLabel
							invalid={error}
							keyboardType="decimal-pad"
							label={t("customLabel", { currency: dir.base, home: dir.quote })}
							onChangeText={(customText) =>
								onChange({ customText, customFlipped: dir.flipped })
							}
							onTypingChange={onTypingChange}
							placeholder={t("enterRate")}
							value={choice.customText}
						/>
					</View>
					<Text tone="fg2">{dir.quote}</Text>
				</View>
			) : null}
			{error ? <FieldError>{t("error")}</FieldError> : null}
			{options && !shared ? (
				<PickerSheet
					clear={tp("clear")}
					empty={t("empty")}
					find={t("find")}
					groups={[
						{
							key: "types",
							heading: t("types", { currency }),
							rows: [
								...options.options.map((o) => ({
									id: o.rateType,
									label: name(o.rateType),
									detail: fmt.pair(o.rate) ?? "",
									lead: null,
									selected: !choice.custom && view.type === o.rateType,
								})),
								{
									id: CUSTOM,
									label: t("custom"),
									lead: null,
									selected: choice.custom,
								},
							],
						},
					]}
					onClose={() => setOpen(false)}
					onSelect={(id) =>
						onChange(
							id === CUSTOM ? startCustom() : { custom: false, rateType: id },
						)
					}
					title={t("title")}
					visible={open}
				/>
			) : null}
		</View>
	);
}
