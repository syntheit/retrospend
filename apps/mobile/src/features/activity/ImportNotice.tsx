import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { openWebPage } from "@/features/settings/webPages";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Glyph } from "@/ui/Glyph";
import { Text } from "@/ui/Text";

/**
 * Imported expenses waiting for a check: an attention notice with one button
 * (the mockup's "Review 12 imported expenses wait for a check", Start). The
 * review is a page on the web for now, so Start opens it. The sentence says
 * what waits, so the fill never carries it alone.
 */
export function ImportNotice({ count }: { count: number }) {
	const t = useTranslations("mobile.activity");
	const { color, radius, size, space } = useTheme();
	const baseUrl = useServerBaseUrl();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[3],
				marginHorizontal: size.gutter.phone,
				marginVertical: space[2],
				padding: space[3],
				borderRadius: radius.ctl,
				backgroundColor: color.attentionBg,
			}}
		>
			<Glyph
				color={color.attentionText}
				name="ListChecks"
				size={size.icon.phone}
			/>
			<Text style={{ flex: 1 }}>{t("importNotice", { count })}</Text>
			{baseUrl ? (
				<Button
					label={t("importStart")}
					onPress={() => void openWebPage(baseUrl, "/import")}
					size="small"
					variant="outlined"
				/>
			) : null}
		</View>
	);
}
