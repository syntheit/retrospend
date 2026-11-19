import { recoveryKeyGroups } from "@retrospend/crypto/client";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";

/** Groups per row: nine in three rows of three. */
const COLUMNS = 3;

/**
 * The mono face. The `font.family.mono` token names JetBrains Mono, which the
 * app does not load yet, so the platform's own monospace stands in: the
 * letters and digits of a key must not be confusable.
 */
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * The recovery key as a grid of its 9 groups, each under its number. A screen
 * reader reads the grid as one labeled group, and each cell character by
 * character, so a group is spelled the way it is copied by hand.
 */
export function RecoveryKeyGrid({ keyText }: { keyText: string }) {
	const t = useTranslations("protection.recoveryKey");
	const { space } = useTheme();
	const groups = recoveryKeyGroups(keyText);
	const rows: string[][] = [];
	for (let i = 0; i < groups.length; i += COLUMNS)
		rows.push(groups.slice(i, i + COLUMNS));
	return (
		<View accessibilityLabel={t("label")} style={{ gap: space[3] }}>
			{rows.map((row, r) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid, rows never reorder
				<View key={r} style={{ flexDirection: "row", gap: space[3] }}>
					{row.map((group, c) => {
						const number = r * COLUMNS + c + 1;
						return (
							<View
								accessibilityLabel={`${t("group", { number })}, ${[...group].join(" ")}`}
								accessible
								key={number}
								style={{ flex: 1, gap: space[1] }}
							>
								<Text tone="fg3" variant="meta">
									{t("group", { number })}
								</Text>
								<Text style={{ fontFamily: MONO }} weight="medium">
									{group}
								</Text>
							</View>
						);
					})}
				</View>
			))}
		</View>
	);
}
