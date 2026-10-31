import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { subscribeEntryChanges } from "@/features/entry/events";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useDataExport } from "@/features/settings/security/useDataExport";
import { useSearchShortcut } from "@/layout/searchShortcut";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Glyph } from "@/ui/Glyph";
import { ListGroup, SectionHeader, StaleNote } from "@/ui/List";
import { rowEnter, rowExit } from "@/ui/motion";
import { Screen } from "@/ui/Screen";
import { Skeleton, SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { TopBar } from "@/ui/TopBar";
import type { MenuItem } from "@/ui/types";
import { AccountRow } from "./AccountRow";
import { AccountSheets, type SheetTarget } from "./AccountSheets";
import { GroupDot } from "./AllocationBar";
import {
	closedAccounts,
	matchingAccounts,
	sectionsOf,
	unvalued,
} from "./accounts";
import { NetWorthChangeSheet } from "./NetWorthChangeSheet";
import { KeyFigures, NetWorthHero } from "./NetWorthHero";
import { useAccountHref } from "./routes";
import { fetchWealth, WEALTH_CACHE, type WealthData } from "./source";
import { useAccountActions } from "./useAccountActions";

/**
 * The header: Add account as a plain plus and a menu for the rest (Add
 * income, Currencies and rates). Neither is the page's primary action, so
 * neither is filled.
 */
function WealthTopBar({ onAdd }: { onAdd: () => void }) {
	const t = useTranslations("mobile.wealth");
	const failed = useTranslations("mobile.settings.data")("failed");
	const add = useOptionalAddEntry();
	const toast = useToast();
	const exporter = useDataExport();
	const items: MenuItem[] = [
		...(add
			? [
					{
						id: "income",
						label: t("menu.income"),
						onPress: () => add.open("income"),
					},
				]
			: []),
		{
			id: "currencies",
			label: t("menu.currencies"),
			onPress: () => router.push("/currencies"),
		},
		{
			id: "export",
			label: t("menu.export"),
			onPress: () => {
				if (exporter.busy) return;
				void exporter.run("wealth").then((ok) => {
					if (!ok) toast.show({ message: failed });
				});
			},
		},
	];
	return (
		<TopBar
			actions={[
				{
					id: "add",
					icon: "Plus",
					label: t("account.addTitle"),
					onPress: onAdd,
				},
			]}
			overflow={items}
			overflowLabel={t("more")}
			title={t("title")}
		/>
	);
}

/** Closed accounts sit collapsed under one row that opens them. */
function ClosedToggle({
	count,
	open,
	onToggle,
}: {
	count: number;
	open: boolean;
	onToggle: () => void;
}) {
	const t = useTranslations("mobile.wealth");
	const { color, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={`${t("closed.title")}, ${count}`}
			accessibilityRole="button"
			accessibilityState={{ expanded: open }}
			onPress={onToggle}
			style={{
				minHeight: size.touchMin.phone,
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[4],
				paddingTop: space[4],
			}}
		>
			<View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
				<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
			</View>
			<Text accessibilityRole="header" variant="section">
				{t("closed.title")}
			</Text>
			<Text tabular tone="fg3">
				{count}
			</Text>
			<Text style={{ flex: 1, textAlign: "right" }} tone="fg3" variant="meta">
				{t("closed.notCounted")}
			</Text>
		</Pressable>
	);
}

function AccountsList({
	data,
	query,
	onSheet,
}: {
	data: WealthData;
	/** What the search bar holds; the groups show the accounts that match. */
	query: string;
	onSheet: (target: SheetTarget) => void;
}) {
	const [showClosed, setShowClosed] = useState(false);
	const theme = useTheme();
	const t = useTranslations("mobile.wealth");
	const hrefOf = useAccountHref();
	const money = useMoneyText();
	const actionsFor = useAccountActions(
		useCallback(
			(action, account) => onSheet({ kind: action, account }),
			[onSheet],
		),
	);
	const accounts = matchingAccounts(data.list.accounts, query);
	const sections = sectionsOf(accounts);
	const closed = closedAccounts(accounts);
	const rows = (list: typeof accounts) =>
		list.map((account) => (
			<AccountRow
				account={account}
				actions={actionsFor(account)}
				key={account.id}
				onPress={() => router.push(hrefOf(account.id))}
			/>
		));
	if (query.trim() !== "" && accounts.length === 0) {
		return <EmptyState title={t("noMatch")} />;
	}
	return (
		<View>
			{sections.map((section) => {
				const group = data.summary.groups.find((g) => g.key === section.group);
				return (
					<View key={section.group}>
						<SectionHeader
							dot={<GroupDot series={group?.series ?? null} />}
							title={t(`groups.${section.group}`)}
							total={group?.total ? money(group.total) : undefined}
						/>
						<ListGroup>{rows(section.accounts)}</ListGroup>
					</View>
				);
			})}
			{closed.length > 0 ? (
				<View>
					<ClosedToggle
						count={closed.length}
						onToggle={() => setShowClosed((open) => !open)}
						open={showClosed}
					/>
					{showClosed ? (
						// The opened section fades in and out (200).
						<Animated.View entering={rowEnter(theme)} exiting={rowExit(theme)}>
							<ListGroup>{rows(closed)}</ListGroup>
						</Animated.View>
					) : null}
				</View>
			) : null}
		</View>
	);
}

/** What shows while Wealth loads: the shape of the hero and a few rows, so nothing jumps. */
function WealthSkeleton() {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			<View style={{ gap: space[2], padding: space[4] }}>
				<Skeleton shape="line" width="25%" />
				<Skeleton shape="line" width="60%" />
				<Skeleton shape="line" width="45%" />
			</View>
			<SkeletonRows count={6} />
		</View>
	);
}

/**
 * Wealth: net worth with its trend, then the accounts by group. A row opens
 * the account's page; Add account and the menu are in the header. Phone: one
 * column. iPad and wide Android: the hero and chart on one side, the accounts
 * beside them.
 */
export function WealthView() {
	const t = useTranslations("mobile.wealth");
	const tc = useTranslations("mobile.common");
	const { api } = useSession();
	const { widthClass } = useLayoutClass();
	const { space } = useTheme();
	const fetch = useMemo(() => (api ? fetchWealth(api) : null), [api]);
	const { state, reload } = useCachedRead(WEALTH_CACHE, fetch);
	// An Undo from a toast can land while this screen is already in focus.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);
	const [sheet, setSheet] = useState<SheetTarget | null>(null);
	const [why, setWhy] = useState(false);
	const [query, setQuery] = useState("");
	const searchRef = useSearchShortcut();
	const [refreshing, setRefreshing] = useState(false);
	const refresh = useCallback(async () => {
		setRefreshing(true);
		await reload();
		setRefreshing(false);
	}, [reload]);

	const title = (
		<WealthTopBar onAdd={() => setSheet({ kind: "add", account: null })} />
	);
	if (state.status === "loading")
		return (
			<>
				{title}
				<Screen flush>
					<WealthSkeleton />
				</Screen>
			</>
		);
	if (state.status === "error")
		return (
			<>
				{title}
				<Screen>
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={() => void reload()}
						title={t("error")}
					/>
				</Screen>
			</>
		);

	const data = state.data;
	const home = data.list.home;
	const sheets = (
		<AccountSheets
			home={home}
			onDone={() => void reload()}
			onTarget={setSheet}
			target={sheet}
		/>
	);
	if (data.list.accounts.length === 0) {
		return (
			<>
				{title}
				<Screen onRefresh={refresh} refreshing={refreshing}>
					<EmptyState
						actionLabel={t("account.addTitle")}
						detail={t("emptyDetail")}
						onAction={() => setSheet({ kind: "add", account: null })}
						title={t("empty")}
					/>
				</Screen>
				{sheets}
			</>
		);
	}
	const missing = unvalued(data.list.accounts).length;
	const change = data.netWorth.change;
	const hero = (
		<View style={{ gap: space[2] }}>
			<StaleNote since={state.staleSince} />
			<Text style={{ paddingHorizontal: space[4] }} tone="fg3" variant="meta">
				{t("ratesToday")}
			</Text>
			{missing > 0 ? (
				<Text
					style={{ paddingHorizontal: space[4] }}
					tone="attention"
					variant="small"
				>
					{t("missingRates", { count: missing })}
				</Text>
			) : null}
			<NetWorthHero
				netWorth={data.netWorth}
				onChange={() => setWhy(true)}
				summary={data.summary}
			/>
			<KeyFigures summary={data.summary} />
		</View>
	);
	return (
		<>
			{title}
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						ref: searchRef,
						placeholder: t("search"),
						onChangeText: (event) => setQuery(event.nativeEvent.text),
					},
				}}
			/>
			<Screen flush onRefresh={refresh} refreshing={refreshing}>
				{widthClass === "compact" ? (
					<>
						{hero}
						<AccountsList data={data} onSheet={setSheet} query={query} />
					</>
				) : (
					<View style={{ flexDirection: "row", gap: space[6] }}>
						<View style={{ flex: 1 }}>{hero}</View>
						<View style={{ flex: 1 }}>
							<AccountsList data={data} onSheet={setSheet} query={query} />
						</View>
					</View>
				)}
			</Screen>
			{change ? (
				<NetWorthChangeSheet
					change={change}
					onClose={() => setWhy(false)}
					visible={why}
				/>
			) : null}
			{sheets}
		</>
	);
}
