import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatMoney } from "@/lib/money";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { PickerSheet } from "@/ui/PickerSheet";
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
	const { color, space, type } = useTheme();
	const [open, setOpen] = useState(false);
	const view = rateView(options, choice, keptHome);
	// Offline before the first answer: nothing to pick from or show yet.
	if (!options && !choice.custom && !view.home) return null;
	const typeName = name(view.type);
	const home = view.home ? format(view.home) : null;
	const muted = { color: color.fg2, fontSize: type.small.size } as const;

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
					<Text
						accessibilityHint={t("sharedFixed")}
						style={[muted, { flexShrink: 1 }]}
					>
						{t("fixed", { type: typeName })}
					</Text>
				) : view.missing ? (
					<>
						<Text
							accessibilityRole="alert"
							style={{
								flexShrink: 1,
								color: color.attentionText,
								fontSize: type.small.size,
							}}
						>
							{t("missing", { currency })}
						</Text>
						<Button
							label={t("enterRate")}
							onPress={() => onChange({ custom: true })}
							variant="text"
						/>
					</>
				) : (
					<Button
						accessibilityLabel={t("triggerLabel", { type: typeName })}
						label={t("trigger", { type: typeName })}
						onPress={() => setOpen(true)}
						variant="text"
					/>
				)}
				<View style={{ flex: 1 }} />
				{home ? (
					<Text
						accessibilityLabel={t("homeLabel", { amount: home })}
						numberOfLines={1}
						style={[
							muted,
							{ fontVariant: ["tabular-nums"], textAlign: "right" },
						]}
					>
						{home}
					</Text>
				) : null}
			</View>
			{choice.custom && !shared ? (
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{t("customUnit", { currency })}
					</Text>
					<View style={{ flex: 1 }}>
						<TextField
							hideLabel
							invalid={error}
							keyboardType="decimal-pad"
							label={t("customLabel", { currency, home: homeCurrency })}
							onChangeText={(customText) => onChange({ customText })}
							onTypingChange={onTypingChange}
							placeholder={t("enterRate")}
							value={choice.customText}
						/>
					</View>
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{homeCurrency}
					</Text>
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
									detail: `${format(o.rate.unit, { cents: false }) ?? ""} = ${format(o.rate.value) ?? ""}`,
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
							id === CUSTOM
								? { custom: true }
								: { custom: false, rateType: id },
						)
					}
					title={t("title")}
					visible={open}
				/>
			) : null}
		</View>
	);
}
