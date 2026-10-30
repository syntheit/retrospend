import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { CurrencyFlag } from "@/ui/CurrencyFlag";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
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
	const { space } = useTheme();
	const hasRate = priced(row);
	const blocked = !row.favorite && !row.rateId;
	const several = row.rates.length > 1;
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
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}
				>
					<CurrencyFlag code={row.code} />
					<View style={{ flex: 1, gap: space[1] }}>
						<Text>{name(row.code)}</Text>
						<Text tone="fg3" variant="meta">
							{hasRate && table.updated
								? t("sub", { code: row.code, date: day(table.updated) })
								: row.code}
						</Text>
					</View>
				</View>
				{hasRate ? (
					<View>
						<Text accessibilityRole="header" variant="section">
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
									<Text tone="fg3">{tc("noRate")}</Text>
								)}
							</TypeLine>
						))}
					</View>
				) : (
					<View style={{ gap: space[2] }}>
						<Text tone="attention">{t("noRate", { code: row.code })}</Text>
						{row.usedBy.length ? (
							<Text tone="fg3" variant="meta">
								{t("usedBy", { names: row.usedBy.join(", ") })}
							</Text>
						) : null}
					</View>
				)}
				{hasRate && several && row.defaultType ? (
					<View style={{ gap: space[1] }}>
						<Text accessibilityRole="header" variant="section">
							{t("defaultTitle")}
						</Text>
						<Text>{label(row.defaultType)}</Text>
						{table.canSetDefault ? null : (
							<Text tone="fg3" variant="meta">
								{t("defaultFixed")}
							</Text>
						)}
					</View>
				) : null}
				{hasRate ? <ConvertBlock home={table.home} row={row} /> : null}
				{blocked ? (
					<Text tone="fg3" variant="meta">
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
