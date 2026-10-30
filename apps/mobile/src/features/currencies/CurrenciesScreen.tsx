import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useFormatMoney, useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { CurrencyFlag } from "@/ui/CurrencyFlag";
import { EmptyState } from "@/ui/EmptyState";
import { ListGroup, ListRow, StaleNote } from "@/ui/List";
import { RowMenu } from "@/ui/RowMenu";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
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
	missingRows,
	type RateTable,
	readConvQuery,
	TOGGLE_FILTERS,
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
	const { space } = useTheme();
	const { result, failed } = useConvert(
		query.code,
		query.minor,
		query.direction,
	);
	return (
		<View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
			<Text accessibilityRole="header" variant="section">
				{t("quickTitle", {
					amount: format({ minor: query.minor, currency: query.from }) ?? "",
					to: query.to,
				})}
			</Text>
			{failed ? (
				<Text tone="danger" variant="small">
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
	const price = defaultPrice(row);
	const { space } = useTheme();
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
		<RowMenu items={items} onPress={onOpen} title={row.code}>
			<ListRow
				end={
					price && row.defaultType ? (
						<View style={{ alignItems: "flex-end" }}>
							<PriceText price={price} showBase={price.base !== row.code} />
							<Text tone="fg3" variant="meta">
								{label(row.defaultType)}
							</Text>
						</View>
					) : (
						<Text tone="attention">{t("noRate")}</Text>
					)
				}
				lead={
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space[3],
						}}
					>
						<StarButton busy={busy} onToggle={onFavorite} row={row} />
						<CurrencyFlag code={row.code} />
					</View>
				}
				sub={
					price ? (
						name(row.code)
					) : (
						<Text tone="attention" variant="meta">
							{t("noRateSub")}
						</Text>
					)
				}
				title={row.code}
			/>
		</RowMenu>
	);
}

/** The line under the title: the shared unit, how fresh the rates are, the default type. */
function TableNote({ table }: { table: RateTable }) {
	const t = useTranslations("mobile.currencies");
	const label = useRateLabel();
	const day = useDayText();
	const { space } = useTheme();
	const text = [
		table.base
			? t("pricesIn", { base: table.base })
			: t("pricesInHome", { home: table.home }),
		table.updated ? t("updated", { date: day(table.updated) }) : null,
		table.homeDefault ? t("newUse", { type: label(table.homeDefault) }) : null,
	]
		.filter(Boolean)
		.join(" ");
	if (!text) return null;
	return (
		<Text
			style={{ paddingHorizontal: space[4], paddingTop: space[2] }}
			tone="fg2"
			variant="small"
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
	const { color, space } = useTheme();
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
				headerLargeTitle: Platform.OS === "ios",
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
				{/* The scroll view is there from the first frame, so the large title can track it. */}
				<Screen flush>
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
				</Screen>
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
			<Screen flush onRefresh={() => void reload()} refreshing={false}>
				<StaleNote since={state.status === "ready" ? state.staleSince : null} />
				<TableNote table={table} />
				<View
					style={{
						flexDirection: "row",
						flexWrap: "wrap",
						gap: space[2],
						paddingHorizontal: space[4],
						paddingVertical: space[3],
					}}
				>
					{TOGGLE_FILTERS.map((id) => (
						<Chip
							key={id}
							label={t(`filter.${id}`)}
							onPress={() => setFilter(filter === id ? "all" : id)}
							selected={filter === id}
						/>
					))}
				</View>
				{conv ? <QuickConvert home={table.home} query={conv} /> : null}
				{missing.length ? (
					<Text
						style={{
							paddingHorizontal: space[4],
							paddingBottom: space[3],
						}}
						tone="attention"
						variant="small"
					>
						{t("missing", {
							codes: missing.map((m) => m.code).join(", "),
							names: usedBy.join(", "),
							count: usedBy.length,
						})}
					</Text>
				) : null}
				{rows.length === 0 ? (
					empty
				) : (
					<ListGroup>
						{rows.map((item) => (
							<CurrencyLine
								busy={pending}
								key={item.code}
								onFavorite={(on) => void setFavorite(item, on)}
								onOpen={() => setOpen(item.code)}
								row={item}
								table={table}
							/>
						))}
					</ListGroup>
				)}
			</Screen>
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
