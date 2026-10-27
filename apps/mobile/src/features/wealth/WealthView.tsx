import { router, Stack } from "expo-router";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { SectionHeader, StaleNote } from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { AccountRow } from "./AccountRow";
import { closedAccounts, sectionsOf, unvalued } from "./accounts";
import { ChangeParts } from "./ChangeParts";
import { NetWorthHero } from "./NetWorthHero";
import { useAccountHref } from "./routes";
import { fetchWealth, WEALTH_CACHE, type WealthData } from "./source";

function AccountsList({ data }: { data: WealthData }) {
	const t = useTranslations("mobile.wealth");
	const { color, space, type } = useTheme();
	const hrefOf = useAccountHref();
	const openAccount = (id: string) => router.push(hrefOf(id));
	const accounts = data.list.accounts;
	const sections = sectionsOf(accounts);
	const closed = closedAccounts(accounts);
	const missing = unvalued(accounts);
	return (
		<View>
			{missing.length > 0 ? (
				<Text
					style={{
						color: color.attentionText,
						fontSize: type.small.size,
						padding: space[4],
					}}
				>
					{t("withoutRate", { count: missing.length })}
				</Text>
			) : null}
			{sections.map((section) => (
				<View key={section.group}>
					<SectionHeader
						detail={String(section.accounts.length)}
						title={t(`groups.${section.group}`)}
					/>
					{section.accounts.map((account) => (
						<AccountRow
							account={account}
							key={account.id}
							onPress={() => openAccount(account.id)}
						/>
					))}
				</View>
			))}
			{closed.length > 0 ? (
				<View>
					<SectionHeader
						detail={String(closed.length)}
						title={t("closed.title")}
					/>
					{closed.map((account) => (
						<AccountRow
							account={account}
							key={account.id}
							onPress={() => openAccount(account.id)}
						/>
					))}
				</View>
			) : null}
			<Text
				style={{
					color: color.fg2,
					fontSize: type.small.size,
					padding: space[4],
				}}
			>
				{t("webForNow")}
			</Text>
		</View>
	);
}

/**
 * Wealth: net worth with its trend and why it moved, then the accounts by
 * group. Phone: one column. iPad and wide Android: the hero and chart on one
 * side, the accounts beside them.
 */
export function WealthView() {
	const t = useTranslations("mobile.wealth");
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const { widthClass } = useLayoutClass();
	const { space } = useTheme();
	const fetch = useMemo(() => (api ? fetchWealth(api) : null), [api]);
	const { state } = useCachedRead(WEALTH_CACHE, fetch);

	const title = <Stack.Screen options={{ title: t("title") }} />;
	if (state.status === "loading")
		return (
			<>
				{title}
				<Screen>
					<EmptyState title={loading} />
				</Screen>
			</>
		);
	if (state.status === "error")
		return (
			<>
				{title}
				<Screen>
					<EmptyState detail={t("errorDetail")} title={t("error")} />
				</Screen>
			</>
		);

	const data = state.data;
	const hero = (
		<View>
			<StaleNote since={state.staleSince} />
			<NetWorthHero netWorth={data.netWorth} />
			{data.netWorth.change ? (
				<ChangeParts change={data.netWorth.change} />
			) : null}
		</View>
	);
	if (data.list.accounts.length === 0) {
		return (
			<>
				{title}
				<Screen>
					<EmptyState detail={t("emptyDetail")} title={t("empty")} />
				</Screen>
			</>
		);
	}
	return (
		<>
			{title}
			<Screen flush>
				{widthClass === "compact" ? (
					<>
						{hero}
						<AccountsList data={data} />
					</>
				) : (
					<View style={{ flexDirection: "row", gap: space[6] }}>
						<View style={{ flex: 1 }}>{hero}</View>
						<View style={{ flex: 1 }}>
							<AccountsList data={data} />
						</View>
					</View>
				)}
			</Screen>
		</>
	);
}
