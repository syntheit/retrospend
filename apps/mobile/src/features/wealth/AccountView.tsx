import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { ENTITY_CACHE_LIMIT } from "@/features/read/loadCached";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import {
	LinkButton,
	ListRow,
	SectionHeader,
	StaleNote,
} from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { isLiability } from "./accounts";
import {
	ACCOUNT_CACHE_PREFIX,
	type AccountLeg,
	accountCache,
	fetchAccount,
} from "./source";
import { UpdateBalanceSheet } from "./UpdateBalanceSheet";

const LEGS_PAGE = 20;

function LegRow({ leg }: { leg: AccountLeg }) {
	const t = useTranslations("mobile.wealth.leg");
	const format = useFormatter();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const date = format.dateTime(new Date(`${leg.date}T12:00:00Z`), {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
	const label = leg.notLogged ? t("notLogged") : t(leg.source);
	const amount = money(leg.amount, { sign: "exceptZero" });
	return (
		<ListRow accessibilityLabel={`${label}, ${date}, ${amount}`}>
			<View style={{ flex: 1, gap: space[1] }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{label}
				</Text>
				<Text style={{ color: color.fg2, fontSize: type.small.size }}>
					{date}
				</Text>
			</View>
			<Text
				style={{
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
					textAlign: "right",
				}}
			>
				{amount}
			</Text>
		</ListRow>
	);
}

/**
 * One account: what it holds (in its own currency, with the home value
 * beside it), Update balance, and its history. The history is the server's
 * newest legs; a balance update shows as Not logged.
 */
export function AccountView({ id }: { id: string }) {
	const t = useTranslations("mobile.wealth");
	const format = useFormatter();
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const { color, space, type } = useTheme();
	const [updating, setUpdating] = useState(false);
	const [shown, setShown] = useState(LEGS_PAGE);
	const fetch = useMemo(() => (api ? fetchAccount(api, id) : null), [api, id]);
	const { state, reload } = useCachedRead(accountCache(id), fetch, {
		prefix: ACCOUNT_CACHE_PREFIX,
		keep: ENTITY_CACHE_LIMIT,
	});

	if (state.status !== "ready") {
		return (
			<Screen>
				<EmptyState
					detail={state.status === "error" ? t("errorDetail") : undefined}
					title={state.status === "error" ? t("accountError") : loading}
				/>
			</Screen>
		);
	}
	const account = state.data;
	const closed = account.closedAt !== null;
	const liability = isLiability(account.type);
	const foreign =
		account.value !== null &&
		account.value.currency !== account.balance.currency;
	const updated = format.dateTime(new Date(account.updatedAt), {
		dateStyle: "medium",
	});

	return (
		<>
			<Stack.Screen options={{ title: account.name }} />
			<Screen flush>
				<StaleNote since={state.staleSince} />
				<View style={{ gap: space[2], padding: space[4] }}>
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{liability ? t("owedNow") : t("balance")}
					</Text>
					<MoneyAmount
						align="left"
						home={account.value}
						rateType={foreign ? (account.rateType ?? undefined) : undefined}
						size="hero"
						value={account.balance}
					/>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{[
							t(`types.${account.type}`),
							closed ? t("closed.badge") : t("updatedOn", { date: updated }),
						].join(" · ")}
					</Text>
					{account.value === null ? (
						<Text
							style={{ color: color.attentionText, fontSize: type.small.size }}
						>
							{t("noRate", { currency: account.balance.currency })}
						</Text>
					) : null}
				</View>
				{closed ? null : (
					<View
						style={{ alignItems: "flex-start", paddingHorizontal: space[4] }}
					>
						<Button
							label={t("update.title")}
							onPress={() => setUpdating(true)}
						/>
					</View>
				)}
				<SectionHeader title={t("history")} />
				{account.legs.length === 0 ? (
					<Text
						style={{
							color: color.fg2,
							fontSize: type.body.size,
							paddingHorizontal: space[4],
						}}
					>
						{t("noHistory")}
					</Text>
				) : (
					account.legs
						.slice(0, shown)
						.map((leg) => <LegRow key={leg.id} leg={leg} />)
				)}
				{shown < account.legs.length ? (
					<LinkButton
						label={t("showMore")}
						onPress={() => setShown((n) => n + LEGS_PAGE)}
					/>
				) : null}
			</Screen>
			<UpdateBalanceSheet
				account={account}
				onClose={() => setUpdating(false)}
				onDone={() => void reload()}
				visible={updating}
			/>
		</>
	);
}
