import { ScrollView, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { ConvertBlock } from "./ConvertBlock";
import {
	PriceText,
	TypeLine,
	useCurrencyName,
	useDayText,
	useRateLabel,
} from "./parts";
import { type CurrencyRow, priced, type RateTable } from "./source";

/**
 * One currency: its price per rate type (the default marked), the default
 * for new expenses, the star and the converter. A currency with no rate says
 * so and names the accounts it leaves out of totals.
 */
export function CurrencySheet({
	table,
	row,
	busy,
	onFavorite,
	onClose,
}: {
	table: RateTable;
	row: CurrencyRow;
	busy: boolean;
	onFavorite: (on: boolean) => void;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.currencies.detail");
	const tc = useTranslations("mobile.currencies");
	const ts = useTranslations("mobile.currencies.star");
	const name = useCurrencyName();
	const label = useRateLabel();
	const day = useDayText();
	const { color, space, type } = useTheme();
	const hasRate = priced(row);
	const blocked = !row.favorite && !row.rateId;
	const several = row.rates.length > 1;
	const sectionTitle = {
		color: color.fg,
		fontSize: type.section.size,
		fontWeight: "600" as const,
	};
	return (
		<Sheet
			detents={["medium", "large"]}
			onClose={onClose}
			title={t("title", { code: row.code })}
			visible
		>
			<ScrollView
				contentContainerStyle={{ gap: space[6], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				<View style={{ gap: space[1] }}>
					<Text style={{ color: color.fg, fontSize: type.body.size }}>
						{name(row.code)}
					</Text>
					<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
						{hasRate && table.updated
							? t("sub", { code: row.code, date: day(table.updated) })
							: row.code}
					</Text>
				</View>
				{hasRate ? (
					<View>
						<Text accessibilityRole="header" style={sectionTitle}>
							{t("rates")}
						</Text>
						{row.rates.map((r) => (
							<TypeLine
								derived={
									r.derived ? tc("derived", { home: table.home }) : undefined
								}
								key={r.type}
								label={label(r.type)}
								note={
									several && r.type === row.defaultType
										? t("default")
										: undefined
								}
							>
								{r.price ? (
									<PriceText price={r.price} showBase />
								) : (
									<Text style={{ color: color.fg3, fontSize: type.body.size }}>
										{tc("noRate")}
									</Text>
								)}
							</TypeLine>
						))}
					</View>
				) : (
					<View style={{ gap: space[2] }}>
						<Text
							style={{ color: color.attentionText, fontSize: type.body.size }}
						>
							{t("noRate", { code: row.code })}
						</Text>
						{row.usedBy.length ? (
							<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
								{t("usedBy", { names: row.usedBy.join(", ") })}
							</Text>
						) : null}
					</View>
				)}
				{hasRate && several && row.defaultType ? (
					<View style={{ gap: space[1] }}>
						<Text accessibilityRole="header" style={sectionTitle}>
							{t("defaultTitle")}
						</Text>
						<Text style={{ color: color.fg, fontSize: type.body.size }}>
							{label(row.defaultType)}
						</Text>
						{table.canSetDefault ? null : (
							<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
								{t("defaultFixed")}
							</Text>
						)}
					</View>
				) : null}
				{hasRate ? <ConvertBlock home={table.home} row={row} /> : null}
				{blocked ? (
					<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
						{ts("unavailable", { code: row.code })}
					</Text>
				) : (
					<Button
						disabled={busy}
						label={row.favorite ? tc("menu.unfavorite") : tc("menu.favorite")}
						onPress={() => onFavorite(!row.favorite)}
						variant="outlined"
					/>
				)}
			</ScrollView>
		</Sheet>
	);
}
