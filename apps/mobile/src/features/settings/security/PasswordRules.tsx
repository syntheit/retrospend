import { PASSWORD_CHECKS, passwordChecks } from "@retrospend/api-contract";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { Text } from "@/ui/Text";

/** The new password's rules as checks that light up while typing. The words are Change password's. */
export function PasswordRules({ value }: { value: string }) {
	const t = useTranslations("mobile.settings.security.password");
	const { color, space, type } = useTheme();
	const checks = passwordChecks(value);
	return (
		<View accessibilityLabel={t("rules")} style={{ gap: space[2] }}>
			{PASSWORD_CHECKS.map((c) => (
				<View
					accessibilityLabel={`${t(`check.${c}`)}, ${checks[c] ? t("met") : t("notMet")}`}
					accessible
					key={c}
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<View style={{ opacity: checks[c] ? 1 : 0 }}>
						<Glyph color={color.fg} name="Check" size={type.small.size} />
					</View>
					<Text tone={checks[c] ? "fg" : "fg3"} variant="small">
						{t(`check.${c}`)}
					</Text>
				</View>
			))}
		</View>
	);
}
