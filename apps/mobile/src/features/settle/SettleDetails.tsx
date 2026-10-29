import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useRateTypeName } from "@/lib/rateTypes";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { Text } from "@/ui/Text";
import { FieldLabel } from "@/ui/TextField";
import type { RateChoices } from "./plan";
import type { SharedMethod } from "./useSettle";

/** Offered to everyone, besides the methods you share with the person. */
const GENERIC_METHODS = ["bank_transfer", "cash"];

function ChipRow({ children }: { children: React.ReactNode }) {
	const { space } = useTheme();
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
			{children}
		</View>
	);
}

/**
 * The rate type a conversion uses (GUIDELINE 7), with the rate each debt
 * currency takes now: "1 BRL = ARS 271 at Blue". A new type moves Everything
 * and the parts, so the chips are there whenever anything converts.
 */
export function RateChips({
	choices,
	onPick,
}: {
	choices: RateChoices;
	onPick: (type: string) => void;
}) {
	const t = useTranslations("mobile.settle");
	const money = useMoneyText();
	const rateName = useRateTypeName();
	const { space } = useTheme();
	const label = t("rate", { currency: choices.currencies.join(", ") });
	return (
		<View style={{ gap: space[1] }}>
			<FieldLabel>{label}</FieldLabel>
			{choices.types.length > 0 ? (
				<ChipRow>
					{choices.types.map((type) => (
						<Chip
							key={type}
							label={rateName(type)}
							onPress={() => onPick(type)}
							selected={choices.current === type}
						/>
					))}
				</ChipRow>
			) : null}
			{choices.rates.map((rate) => (
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
 * money. Picking a method again clears it; the day starts on today.
 */
export function MethodAndDate({
	shared,
	method,
	onMethod,
	today,
	yesterday,
	paidOn,
	onPaidOn,
}: {
	shared: SharedMethod[];
	method: string | null;
	onMethod: (method: string | null) => void;
	today: string;
	yesterday: string;
	paidOn: string | null;
	onPaidOn: (day: string) => void;
}) {
	const t = useTranslations("mobile.settle");
	const { space } = useTheme();
	const names = new Map<string, string>(
		shared.map((m) => [m.type, m.label ?? ""]),
	);
	const types = [
		...new Set([...shared.map((m) => m.type), ...GENERIC_METHODS]),
	];
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
			<View style={{ gap: space[1] }}>
				<FieldLabel>{t("date")}</FieldLabel>
				<ChipRow>
					<Chip
						label={t("today")}
						onPress={() => onPaidOn(today)}
						selected={day === today}
					/>
					<Chip
						label={t("yesterday")}
						onPress={() => onPaidOn(yesterday)}
						selected={day === yesterday}
					/>
				</ChipRow>
			</View>
		</>
	);
}
