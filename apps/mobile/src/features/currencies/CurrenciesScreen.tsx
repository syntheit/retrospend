import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { StaleNote } from "@/ui/List";
import { FLOATING_ADD_INSET } from "@/layout/destinations";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Menu } from "@/ui/Menu";
import { RowMenu } from "@/ui/RowMenu";
import { ConversionLines } from "./ConvertBlock";
import { CurrencySheet } from "./CurrencySheet";
import {
	PriceText,
	StarButton,
	useCurrencyName,
	useDayText,
	useRateLabel,
} from "./parts";
import {
	type ConvQuery,
	type CurrencyFilter,
	type CurrencyRow,
	defaultPrice,
	FILTERS,
	missingRows,
	type RateTable,
	readConvQuery,
	visibleRows,
} from "./source";
import { useConvert, useFavorite, useRateTable } from "./useCurrencies";

/** The rate history of a currency against home, on xe.com (as on the web). */
function openHistory(code: string, home: string) {
	void WebBrowser.openBrowserAsync(
		`https://www.xe.com/currencycharts/?from=${encodeURIComponent(code)}&to=${encodeURIComponent(home)}`,
	);
}

/** The search field's converter: every rate type, from the server. */
function QuickConvert({ query, home }: { query: ConvQuery; home: string }) {
	const t = useTranslations("mobile.currencies.convert");
	const { format } = useFormatMoney();
	const { color, space, type } = useTheme();
	const { result, failed } = useConvert(
		query.code,
		query.minor,
		query.direction,
	);
	return (
		<View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{t("quickTitle", {
					amount: format({ minor: query.minor, currency: query.from }) ?? "",
					to: query.to,
				})}
			</Text>
			{failed ? (
				<Text style={{ color: color.danger, fontSize: type.small.size }}>
					{t("failed")}
				</Text>
			) : (
				<ConversionLines home={home} result={result} />
			)}
		</View>
	);
}

function CurrencyLine({
	row,
	table,
	busy,
	onOpen,
	onFavorite,
}: {
	row: CurrencyRow;
	table: RateTable;
	busy: boolean;
	onOpen: () => void;
	onFavorite: (on: boolean) => void;
}) {
	const t = useTranslations("mobile.currencies");
	const name = useCurrencyName();
	const label = useRateLabel();
	const { color, size, space, type } = useTheme();
	const price = defaultPrice(row);
	const canStar = row.favorite || row.rateId !== null;
	const items = [
		{ id: "convert", label: t("menu.convert"), onPress: onOpen },
		...(canStar
			? [
					{
						id: "favorite",
						label: row.favorite ? t("menu.unfavorite") : t("menu.favorite"),
						onPress: () => onFavorite(!row.favorite),
					},
				]
			: []),
		...(row.crypto
			? []
			: [
					{
						id: "history",
						label: t("menu.history"),
						onPress: () => openHistory(row.code, table.home),
					},
				]),
	];
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				paddingLeft: space[4],
				borderBottomWidth: 1,
				borderBottomColor: color.line,
				backgroundColor: color.bg,
			}}
		>
			<StarButton busy={busy} onToggle={onFavorite} row={row} />
			<View style={{ flex: 1 }}>
				<RowMenu items={items} onPress={onOpen} title={row.code}>
					<View
						style={{
							minHeight: size.row.phone,
							flexDirection: "row",
							alignItems: "center",
							gap: space[3],
							paddingLeft: space[3],
							paddingRight: space[4],
							paddingVertical: space[2],
						}}
					>
						<View style={{ flex: 1, gap: space[1] }}>
							<Text
								numberOfLines={1}
								style={{
									color: color.fg,
									fontSize: type.body.size,
									fontWeight: "500",
								}}
							>
								{row.code}
							</Text>
							<Text
								numberOfLines={1}
								style={{
									color: price ? color.fg2 : color.attentionText,
									fontSize: type.small.size,
								}}
							>
								{price ? name(row.code) : t("noRateSub")}
							</Text>
						</View>
						{price && row.defaultType ? (
							<View style={{ alignItems: "flex-end", gap: space[1] }}>
								<PriceText price={price} showBase={!table.base} />
								<Text style={{ color: color.fg3, fontSize: type.meta.size }}>
									{label(row.defaultType)}
								</Text>
							</View>
						) : (
							<Text
								style={{ color: color.attentionText, fontSize: type.body.size }}
							>
								{t("noRate")}
							</Text>
						)}
					</View>
				</RowMenu>
			</View>
		</View>
	);
}

/** The line under the title: the shared unit, how fresh the rates are, the default type. */
function TableNote({ table }: { table: RateTable }) {
	const t = useTranslations("mobile.currencies");
	const label = useRateLabel();
	const day = useDayText();
	const { color, space, type } = useTheme();
	const text = [
		table.base ? t("pricesIn", { base: table.base }) : null,
		table.updated ? t("updated", { date: day(table.updated) }) : null,
		table.homeDefault ? t("newUse", { type: label(table.homeDefault) }) : null,
	]
		.filter(Boolean)
		.join(" ");
	if (!text) return null;
	return (
		<Text
			style={{
				color: color.fg2,
				fontSize: type.small.size,
				paddingHorizontal: space[4],
				paddingTop: space[2],
			}}
		>
			{text}
		</Text>
	);
}

/**
 * Currencies: every currency priced in the home currency at its default
 * rate type (the other types in its sheet), stars that keep favorites
 * first here and in the currency picker, and a converter. The search field
 * also converts ("100 usd", "50000 ars to brl"). Every price and every
 * conversion is the server's; this screen formats them only.
 */
export function CurrenciesScreen() {
	const t = useTranslations("mobile.currencies");
	const { color, space, type } = useTheme();
	const locale = useMoneyLocale();
	const name = useCurrencyName();
	const searchRef = useSearchShortcut();
	const { state, reload } = useRateTable();
	const { setFavorite, pending } = useFavorite(reload);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<CurrencyFilter>("all");
	const [open, setOpen] = useState<string | null>(null);

	const table = state.status === "ready" ? state.data : null;
	const conv = table
		? readConvQuery(query, table.home, table.rows, locale)
		: null;
	const rows = table ? visibleRows(table.rows, filter, query, name, conv) : [];
	const missing = table ? missingRows(table.rows) : [];
	const openRow = table?.rows.find((r) => r.code === open) ?? null;

	const header = (
		<Stack.Screen
			options={{
				title: t("title"),
				headerSearchBarOptions: {
					ref: searchRef,
					placeholder: t("search"),
					onChangeText: (event) => setQuery(event.nativeEvent.text),
				},
			}}
		/>
	);

	if (!table) {
		return (
			<View style={{ flex: 1, backgroundColor: color.bg }}>
				{header}
				{state.status === "error" ? (
					<EmptyState
						actionLabel={t("retry")}
						detail={t("errorDetail")}
						onAction={() => void reload()}
						title={t("error")}
					/>
				) : (
					<EmptyState title={t("loading")} />
				)}
			</View>
		);
	}

	const usedBy = missing.flatMap((m) => m.usedBy);
	const empty =
		filter === "favorites" ? (
			<EmptyState
				actionLabel={t("empty.showAll")}
				detail={t("empty.noFavoritesHint")}
				onAction={() => setFilter("all")}
				title={t("empty.noFavorites")}
			/>
		) : (
			<EmptyState
				actionLabel={t("empty.clear")}
				detail={t("empty.noneHint")}
				onAction={() => {
					searchRef.current?.clearText();
					setQuery("");
					setFilter("all");
				}}
				title={t("empty.none")}
			/>
		);

	return (
		<View style={{ flex: 1, backgroundColor: color.bg }}>
			{header}
			<FlatList
				contentInsetAdjustmentBehavior="automatic"
				data={rows}
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
				keyExtractor={(row) => row.code}
				ListEmptyComponent={empty}
				ListFooterComponent={<View style={{ height: FLOATING_ADD_INSET }} />}
				ListHeaderComponent={
					<View style={{ paddingBottom: space[2] }}>
						<StaleNote
							since={state.status === "ready" ? state.staleSince : null}
						/>
						<TableNote table={table} />
						<View
							style={{
								flexDirection: "row",
								paddingHorizontal: space[4],
								paddingTop: space[3],
							}}
						>
							<Menu
								accessibilityLabel={`${t("filter.label")}, ${t(`filter.${filter}`)}`}
								items={FILTERS.map((id) => ({
									id,
									label: t(`filter.${id}`),
									onPress: () => setFilter(id),
								}))}
								label={t(`filter.${filter}`)}
							/>
						</View>
						{conv ? <QuickConvert home={table.home} query={conv} /> : null}
						{missing.length ? (
							<Text
								style={{
									color: color.attentionText,
									fontSize: type.small.size,
									paddingHorizontal: space[4],
									paddingTop: space[3],
								}}
							>
								{t("missing", {
									codes: missing.map((m) => m.code).join(", "),
									names: usedBy.join(", "),
									count: usedBy.length,
								})}
							</Text>
						) : null}
					</View>
				}
				onRefresh={reload}
				refreshing={false}
				renderItem={({ item }) => (
					<CurrencyLine
						busy={pending}
						onFavorite={(on) => void setFavorite(item, on)}
						onOpen={() => setOpen(item.code)}
						row={item}
						table={table}
					/>
				)}
				style={{ backgroundColor: color.bg }}
			/>
			{openRow ? (
				<CurrencySheet
					busy={pending}
					onClose={() => setOpen(null)}
					onFavorite={(on) => void setFavorite(openRow, on)}
					row={openRow}
					table={table}
				/>
			) : null}
		</View>
	);
}
