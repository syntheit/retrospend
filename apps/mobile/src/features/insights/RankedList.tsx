import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor, Glyph } from "@/ui/Glyph";
import { LinkButton } from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { ProgressBar } from "@/ui/ProgressBar";
import { Text } from "@/ui/Text";
import { barShares, type RankedRow } from "./rows";
import type { InsightsWords } from "./useInsightsWords";

/** The biggest categories show first; the rest open with one button. */
const FIRST = 8;

/**
 * Ranked bars of categories (GUIDELINE 9): one accent fill on a raised
 * track, the category's bare glyph in its own color carrying identity, the
 * amount at the right edge with tabular figures. The change against the
 * period before follows the name when there is one.
 */
export function RankedList({
	rows,
	words,
}: {
	rows: readonly RankedRow[];
	words: InsightsWords;
}) {
	const t = useTranslations("mobile.insights");
	const noRate = useTranslations("mobile.money")("noRate");
	const money = useMoneyText();
	const { color, size, space } = useTheme();
	const [all, setAll] = useState(false);
	const shown = all ? rows : rows.slice(0, FIRST);
	const shares = barShares(shown.map((r) => r.value));

	return (
		<View>
			{shown.map((row, i) => {
				const name = row.category?.name ?? t("noCategory");
				const note = row.change === undefined ? null : words.change(row.change);
				const tint = row.category
					? categoryColor(color, row.category.tone)
					: color.fg3;
				return (
					<View
						accessibilityLabel={[
							name,
							note,
							row.value ? money(row.value) : noRate,
						]
							.filter(Boolean)
							.join(", ")}
						accessible
						key={row.id}
						style={{
							gap: space[1],
							paddingHorizontal: space[4],
							paddingVertical: space[2],
						}}
					>
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space[2],
							}}
						>
							{row.category ? (
								<CategoryGlyph
									category={row.category}
									color={tint}
									size={size.icon.phone}
								/>
							) : (
								<Glyph color={tint} name="Tag" size={size.icon.phone} />
							)}
							<Text numberOfLines={1} style={{ flexShrink: 1 }}>
								{name}
							</Text>
							{note ? (
								<Text tone="fg3" variant="meta">
									{note}
								</Text>
							) : null}
							<View style={{ flex: 1 }} />
							{row.value ? (
								<MoneyAmount value={row.value} />
							) : (
								<Text tone="fg2">{noRate}</Text>
							)}
						</View>
						<ProgressBar percent={(shares[i] ?? 0) * 100} />
					</View>
				);
			})}
			{rows.length > FIRST ? (
				<LinkButton
					label={
						all ? t("showFewer") : t("showMore", { count: rows.length - FIRST })
					}
					onPress={() => setAll((v) => !v)}
				/>
			) : null}
		</View>
	);
}
