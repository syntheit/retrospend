import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { currenciesHref } from "@/features/account/places";
import { useTheme } from "@/theme";
import { CurrencyFlag } from "@/ui/CurrencyFlag";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet } from "@/ui/Sheet";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { ConvertBlock } from "./ConvertBlock";
import { PriceText, useCurrencyName, useRateLabel } from "./parts";
import { type CurrencyRow, defaultPrice, priced } from "./source";
import { useRateTable } from "./useCurrencies";

/** How many currencies the converter lists: the starred ones, topped up with the first priced. */
const LISTED = 6;

/** The currencies the converter offers: starred first, then the rest in the table's order. */
export function converterRows(rows: readonly CurrencyRow[]): CurrencyRow[] {
	const usable = rows.filter(priced);
	return [
		...usable.filter((r) => r.favorite),
		...usable.filter((r) => !r.favorite),
	].slice(0, LISTED);
}

/**
 * The quick converter behind Home's currency button: today's rate of a few
 * currencies (the starred ones first) and the converter for the one picked.
 * It reads the same rate table as Currencies and converts on the server; the
 * full list stays one tap away.
 */
export function ConverterSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.currencies.converter");
	const tc = useTranslations("mobile.common");
	const tr = useTranslations("mobile.currencies");
	const name = useCurrencyName();
	const label = useRateLabel();
	const { space } = useTheme();
	const { state, reload } = useRateTable();
	const [picked, setPicked] = useState<string | null>(null);
	const table = state.status === "ready" ? state.data : null;
	const listed = table ? converterRows(table.rows) : [];
	const row = listed.find((r) => r.code === picked) ?? listed[0] ?? null;

	return (
		<Sheet
			detents={["large"]}
			onClose={onClose}
			title={t("title")}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[6], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
			>
				{state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={tr("errorDetail")}
						onAction={() => void reload()}
						title={tr("error")}
					/>
				) : !table ? (
					<SkeletonRows />
				) : row ? (
					<>
						<View style={{ marginHorizontal: -space[4] }}>
							<ListGroup>
								{listed.map((item) => {
									const price = defaultPrice(item);
									return (
										<ListRow
											end={
												price && item.defaultType ? (
													<View style={{ alignItems: "flex-end" }}>
														<PriceText
															price={price}
															showBase={price.base !== item.code}
														/>
														<Text tone="fg3" variant="meta">
															{label(item.defaultType)}
														</Text>
													</View>
												) : undefined
											}
											key={item.code}
											lead={<CurrencyFlag code={item.code} />}
											onPress={() => setPicked(item.code)}
											selected={item.code === row.code}
											sub={name(item.code)}
											title={item.code}
										/>
									);
								})}
							</ListGroup>
						</View>
						<ConvertBlock home={table.home} key={row.code} row={row} />
						<TextAction
							label={t("all")}
							onPress={() => {
								onClose();
								router.push(currenciesHref());
							}}
						/>
					</>
				) : (
					<EmptyState title={tr("empty.none")} />
				)}
			</ScrollView>
		</Sheet>
	);
}
