import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { applyKey, BACKSPACE, keypadLayout } from "./keypad";

/**
 * The amount keypad: the twelve keys of the system number pad with the
 * locale's decimal key. Digits sit on raised keys; the decimal and Delete
 * keys are flat, as on the system pad. Keys are 48 points high on the
 * composer and 44 in a sheet (`compact`), set here and not by each caller.
 * Every key is a labeled button, so VoiceOver and TalkBack read "5",
 * "Delete", "Decimal point". The draft text is formatted by the domain
 * package, never here.
 */
export function MoneyKeypad({
	draft,
	currency,
	onDraftChange,
	compact,
}: {
	draft: string;
	currency: string;
	onDraftChange: (draft: string) => void;
	/** A sheet that also holds fields: 44 point keys. The composer's pad is 48. */
	compact?: boolean;
}) {
	const t = useTranslations("mobile.keypad");
	const locale = useMoneyLocale();
	const { color, font, radius, size, space, type } = useTheme();
	const rows = keypadLayout(locale);
	const decimal = rows[3]?.[0];

	function labelOf(key: string) {
		if (key === BACKSPACE) return t("delete");
		if (key === decimal) return t("decimal");
		return key;
	}

	return (
		<View style={{ gap: space[2] }}>
			{rows.map((row) => (
				<View
					key={row.join("")}
					style={{ flexDirection: "row", gap: space[2] }}
				>
					{row.map((key) => {
						const flat = key === BACKSPACE || key === decimal;
						return (
							<Pressable
								accessibilityLabel={labelOf(key)}
								accessibilityRole="button"
								key={key}
								onPress={() =>
									onDraftChange(applyKey(draft, key, locale, currency))
								}
								style={({ pressed }) => ({
									flex: 1,
									minHeight: compact ? size.touchMin.phone : space[12],
									alignItems: "center",
									justifyContent: "center",
									borderRadius: radius.ctl,
									backgroundColor: pressed
										? color.line
										: flat
											? "transparent"
											: color.raised,
								})}
							>
								<Text
									style={{
										color: color.fg,
										fontSize: type.title.size,
										fontVariant: ["tabular-nums"],
										fontWeight: String(font.weight.medium) as "500",
									}}
								>
									{key}
								</Text>
							</Pressable>
						);
					})}
				</View>
			))}
		</View>
	);
}
