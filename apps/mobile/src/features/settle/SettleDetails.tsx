import type { Money } from "@retrospend/domain/money-minor";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import { offeredMethods, type RateChoices } from "./plan";
import type { SharedMethod } from "./useSettle";

function ChipRow({ children }: { children: React.ReactNode }) {
	const { space } = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
			{children}
		</View>
	);
}

/**
 * The rate type a conversion uses (GUIDELINE 7). Each chip carries the rate
 * it would use ("Blue ARS 271") when one currency converts; with several, the
 * chips are names and a line under them gives each currency's rate now. A new
 * type moves Everything and the parts, so the chips are there whenever
 * anything converts.
 */
export function RateChips({
	choices,
	values,
	onPick,
}: {
	choices: RateChoices;
	/** What one unit of the converting currency is worth at each type, from the server. */
	values: Record<string, Money>;
	onPick: (type: string) => void;
}) {
	const t = useTranslations("mobile.settle");
	const money = useMoneyText();
	const rateName = useRateTypeName();
	const { space } = useTheme();
	const label = t("rate", { currency: choices.currencies.join(", ") });
	const single = choices.currencies.length === 1 && choices.types.length > 0;
	const chipLabel = (type: string): string => {
		const value =
			values[type] ??
			(choices.current === type ? choices.rates[0]?.value : undefined);
		return single && value
			? t("rateChip", { type: rateName(type), value: money(value) })
			: rateName(type);
	};
	return (
		<View style={{ gap: space[1] }}>
			<FieldLabel>{label}</FieldLabel>
			{choices.types.length > 0 ? (
				<ChipRow>
					{choices.types.map((type) => (
						<Chip
							key={type}
							label={chipLabel(type)}
							onPress={() => onPick(type)}
							selected={choices.current === type}
						/>
					))}
				</ChipRow>
			) : null}
			{(single ? [] : choices.rates).map((rate) => (
				<Text key={rate.currency} tabular tone="fg2" variant="small">
					{t("rateLine", {
						unit: money(rate.unit),
						value: money(rate.value),
						type: rateName(rate.type),
					})}
				</Text>
			))}
		</View>
	);
}

/**
 * How it was paid and on which day: details of the record, they change no
 * money. Picking a method again clears it; the day starts on today and can
 * be any day (Today and Yesterday are shortcuts, the calendar is the field).
 */
export function MethodAndDate({
	shared,
	method,
	onMethod,
	today,
	paidOn,
	onPaidOn,
}: {
	shared: SharedMethod[];
	method: string | null;
	onMethod: (method: string | null) => void;
	today: string;
	paidOn: string | null;
	onPaidOn: (day: string) => void;
}) {
	const t = useTranslations("mobile.settle");
	const { space } = useTheme();
	const names = new Map<string, string>(
		shared.map((m) => [m.type, m.label ?? ""]),
	);
	const types = offeredMethods(shared);
	const nameOf = (type: string): string => {
		const key = `methodNames.${type}` as Parameters<typeof t>[0];
		if (t.has(key)) return t(key);
		const label = names.get(type);
		if (label) return label;
		const words = type.replace(/[_-]+/g, " ");
		return words.charAt(0).toUpperCase() + words.slice(1);
	};
	const day = paidOn ?? today;
	return (
		<>
			<View style={{ gap: space[1] }}>
				<FieldLabel>{t("method")}</FieldLabel>
				<ChipRow>
					{types.map((type) => (
						<Chip
							key={type}
							label={nameOf(type)}
							onPress={() => onMethod(method === type ? null : type)}
							selected={method === type}
						/>
					))}
				</ChipRow>
			</View>
			<DateField
				label={t("date")}
				onChange={onPaidOn}
				quick
				today={today}
				value={day}
			/>
		</>
	);
}
