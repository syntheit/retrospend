import { Pressable, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormatLocale } from "@/lib/intl";
import { useTheme } from "@/theme";
import { applyKey, BACKSPACE, keypadLayout } from "./keypad";

/**
 * The amount keypad for the composer: big touch targets, the locale's
 * decimal key, a "000" key for ARS-sized amounts. Every key is a labeled
 * button, so VoiceOver and TalkBack read "5", "Delete", "Decimal point".
 * The draft text is formatted by the domain package, never here.
 */
export function MoneyKeypad({
	draft,
	currency,
	onDraftChange,
}: {
	draft: string;
	currency: string;
	onDraftChange: (draft: string) => void;
}) {
	const t = useTranslations("mobile.keypad");
	const locale = useFormatLocale();
	const { color, radius, size, space, type } = useTheme();
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
					{row.map((key) => (
						<Pressable
							accessibilityLabel={labelOf(key)}
							accessibilityRole="button"
							key={key}
							onPress={() =>
								onDraftChange(applyKey(draft, key, locale, currency))
							}
							style={({ pressed }) => ({
								flex: 1,
								minHeight: size.touchMin.phone + space[2],
								alignItems: "center",
								justifyContent: "center",
								borderRadius: radius.ctl,
								backgroundColor: pressed ? color.line : color.raised,
							})}
						>
							<Text
								style={{
									color: color.fg,
									fontSize: type.title.size,
									fontVariant: ["tabular-nums"],
									fontWeight: "500",
								}}
							>
								{key}
							</Text>
						</Pressable>
					))}
				</View>
			))}
		</View>
	);
}
