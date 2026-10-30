import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useRateTypeLabel } from "@/ui/Money";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { FieldLabel } from "@/ui/TextField";

/**
 * The rate types the server has for a currency, one chip each under a
 * "Valued at" label, the chosen one on. Shown only when there is a choice.
 * Rates stay on the server: the chips name the type and the server values
 * the account.
 */
export function RateTypeChips({
	types,
	value,
	onChange,
}: {
	types: readonly string[];
	/** The type in use; null when the account sits on the currency's default. */
	value: string | null;
	onChange: (type: string) => void;
}) {
	const t = useTranslations("mobile.wealth");
	const rateName = useRateTypeLabel();
	const { space } = useTheme();
	if (types.length < 2) return null;
	return (
		<View style={{ gap: space[2] }}>
			<FieldLabel>{t("valuedAtLabel")}</FieldLabel>
			<View
				accessibilityLabel={t("valuedAtLabel")}
				accessibilityRole="radiogroup"
				style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}
			>
				{types.map((type) => (
					<Chip
						key={type}
						label={rateName(type)}
						onPress={() => onChange(type)}
						selected={type === value}
					/>
				))}
			</View>
		</View>
	);
}
