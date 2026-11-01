import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useRateFormat } from "@/lib/rateFormat";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import { offeredMethods, type RateChoices, type RateRead } from "./plan";
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
	values: Record<string, RateRead>;
	onPick: (type: string) => void;
}) {
	const t = useTranslations("mobile.settle");
	const rateName = useRateTypeName();
	const fmt = useRateFormat();
	const { space } = useTheme();
	const label = t("rate", { currency: choices.currencies.join(", ") });
	const single = choices.currencies.length === 1 && choices.types.length > 0;
	const chipLabel = (type: string): string => {
		const read =
			values[type] ??
			(choices.current === type ? choices.rates[0] : undefined);
		// The type carries its number (R8): "Blue 1,468.00 ARS" under "{currency} rate".
		const number = read
			? fmt.number(read.unit.currency, read.value.currency, read.rate)
			: null;
		return single && number
			? t("rateChip", { type: rateName(type), value: number })
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
					{fmt.withType(rateName(rate.type), rate)}
				</Text>
			))}
		</View>
	);
}

/**
 * How it was paid: a detail of the record, it changes no money. Picking a
 * method again clears it. The name of a type is the catalog's, else the
 * label the other side gave it, else its words.
 */
export function useMethodName(shared: SharedMethod[]) {
	const t = useTranslations("mobile.settle");
	const names = new Map<string, string>(
		shared.map((m) => [m.type, m.label ?? ""]),
	);
	return (type: string): string => {
		const key = `methodNames.${type}` as Parameters<typeof t>[0];
		if (t.has(key)) return t(key);
		const label = names.get(type);
		if (label) return label;
		const words = type.replace(/[_-]+/g, " ");
		return words.charAt(0).toUpperCase() + words.slice(1);
	};
}

/** The methods you share with them, as chips: the Method panel. */
export function MethodChips({
	shared,
	method,
	onMethod,
}: {
	shared: SharedMethod[];
	method: string | null;
	onMethod: (method: string | null) => void;
}) {
	const t = useTranslations("mobile.settle");
	const nameOf = useMethodName(shared);
	return (
		<View accessibilityLabel={t("method")}>
			<ChipRow>
				{offeredMethods(shared).map((type) => (
					<Chip
						key={type}
						label={nameOf(type)}
						onPress={() => onMethod(method === type ? null : type)}
						selected={method === type}
					/>
				))}
			</ChipRow>
		</View>
	);
}
