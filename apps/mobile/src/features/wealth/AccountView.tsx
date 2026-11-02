import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { ENTITY_CACHE_LIMIT } from "@/features/read/loadCached";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useReloadOnEntryChange } from "@/features/read/useReloadOnEntryChange";
import { useRateFormat } from "@/lib/rateFormat";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { DetailActions } from "@/ui/DetailActions";
import { EmptyState } from "@/ui/EmptyState";
import { Hero } from "@/ui/Hero";
import {
	LinkButton,
	ListGroup,
	ListRow,
	SectionHeader,
	StaleNote,
} from "@/ui/List";
import { heroCents, useRateTypeLabel } from "@/ui/Money";
import { Screen } from "@/ui/Screen";
import { Skeleton, SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { AccountSheets, type SheetTarget } from "./AccountSheets";
import { isLiability } from "./accounts";
import { ACCOUNT_ICON, actionsOf } from "./actions";
import { valuedAt } from "./rateType";
import {
	ACCOUNT_CACHE_PREFIX,
	type AccountLeg,
	accountCache,
	fetchAccount,
} from "./source";

const LEGS_PAGE = 20;

/** The shape of the page while it loads: the figure, its lines, then history rows. */
function AccountSkeleton() {
	const { space } = useTheme();
	return (
		<View style={{ gap: space[4] }}>
			<View style={{ gap: space[2], padding: space[4] }}>
				<Skeleton shape="line" width="25%" />
				<Skeleton shape="line" width="60%" />
				<Skeleton shape="line" width="45%" />
			</View>
			<SkeletonRows count={4} />
		</View>
	);
}

function LegRow({ leg }: { leg: AccountLeg }) {
	const t = useTranslations("mobile.wealth.leg");
	const format = useFormatter();
	const money = useMoneyText();
	const date = format.dateTime(new Date(`${leg.date}T12:00:00Z`), {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
	const label = leg.notLogged ? t("notLogged") : t(leg.source);
	const amount = money(leg.amount, { sign: "exceptZero" });
	return (
		<ListRow
			accessibilityLabel={`${label}, ${date}, ${amount}`}
			end={
				<Text tabular weight="medium">
					{amount}
				</Text>
			}
			sub={date}
			title={label}
		/>
	);
}

/**
 * One account: what it holds (in its own currency, with the home value under
 * it), Update balance as the one primary, and its history in a list group.
 * Edit, Close or Reopen and Delete account are in the header menu. The
 * history is the server's newest legs; a balance update shows as Not logged.
 */
export function AccountView({ id }: { id: string }) {
	const t = useTranslations("mobile.wealth");
	const tc = useTranslations("mobile.common");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const rateName = useRateTypeLabel();
	const rateFmt = useRateFormat();
	const { api, state: session } = useSession();
	const me = session.status === "signedIn" ? session.me : null;
	const { space } = useTheme();
	const [sheet, setSheet] = useState<SheetTarget | null>(null);
	const home = me?.homeCurrency ?? "USD";
	const [shown, setShown] = useState(LEGS_PAGE);
	const fetch = useMemo(() => (api ? fetchAccount(api, id) : null), [api, id]);
	const { state, reload } = useCachedRead(accountCache(id), fetch, {
		prefix: ACCOUNT_CACHE_PREFIX,
		keep: ENTITY_CACHE_LIMIT,
	});
	// An Undo from a toast can land while this screen is already in focus.
	useReloadOnEntryChange(reload);

	if (state.status !== "ready") {
		// Until the account arrives the header would show the route's own name
		// ("[id]"), so the title is empty while it loads.
		return (
			<>
				<Stack.Screen options={{ title: "" }} />
				<Screen flush>
					{state.status === "error" ? (
						<EmptyState
							actionLabel={tc("retry")}
							detail={t("errorDetail")}
							onAction={() => void reload()}
							title={t("accountError")}
						/>
					) : (
						<AccountSkeleton />
					)}
				</Screen>
			</>
		);
	}
	const account = state.data;
	const closed = account.closedAt !== null;
	const liability = isLiability(account.type);
	const currency = account.balance.currency;
	const foreign = account.value !== null && account.value.currency !== currency;
	const sign = liability ? "never" : "auto";
	const rate = valuedAt(account);
	// The type never shows without its number (R8).
	const rateText =
		rate && account.value
			? rateFmt.typed(
					rateName(rate),
					currency,
					account.value.currency,
					account.rate,
				)
			: null;
	const homeLine =
		account.value === null
			? null
			: foreign
				? rateText
					? tm("homeWithRate", {
							amount: money(account.value, { sign }),
							rate: rateText,
						})
					: money(account.value, { sign })
				: null;
	const updated = format.dateTime(new Date(account.updatedAt), {
		dateStyle: "medium",
	});
	// Edit is the pencil in the header; the rest (Close or Reopen, Delete) is
	// in the overflow menu. Update balance is the page's one primary button.
	const menu = actionsOf(account)
		.filter((action) => action !== "update" && action !== "edit")
		.map((action) => ({
			id: action,
			label: t(`actions.${action}`),
			icon: ACCOUNT_ICON[action],
			onPress: () => setSheet({ kind: action, account }),
			destructive: action === "delete",
		}));

	return (
		<>
			<Stack.Screen
				options={{
					title: account.name,
					headerRight: () => (
						<DetailActions
							edit={closed ? null : () => setSheet({ kind: "edit", account })}
							editLabel={t("actions.edit")}
							items={menu}
							moreLabel={t("more")}
						/>
					),
				}}
			/>
			<Screen flush>
				<StaleNote since={state.staleSince} />
				<View style={{ gap: space[3], padding: space[4] }}>
					<Hero
						label={liability ? t("owedNow") : t("balance")}
						sub={homeLine ?? undefined}
						value={money(account.balance, { cents: heroCents(currency), sign })}
					/>
					<Text tone="fg2" variant="small">
						{[
							t(`types.${account.type}`),
							closed ? t("closed.badge") : t("updatedOn", { date: updated }),
						].join(" · ")}
					</Text>
					{account.value === null ? (
						<Text tone="attention" variant="small">
							{t("noRate", { currency })}
						</Text>
					) : null}
					{closed ? null : (
						<View style={{ alignItems: "flex-start" }}>
							<Button
								label={t("update.title")}
								onPress={() => setSheet({ kind: "update", account })}
							/>
						</View>
					)}
				</View>
				<SectionHeader title={t("history")} />
				{account.legs.length === 0 ? (
					<EmptyState inline title={t("noHistory")} />
				) : (
					<ListGroup>
						{account.legs.slice(0, shown).map((leg) => (
							<LegRow key={leg.id} leg={leg} />
						))}
					</ListGroup>
				)}
				{shown < account.legs.length ? (
					<LinkButton
						label={t("showMore")}
						onPress={() => setShown((n) => n + LEGS_PAGE)}
					/>
				) : null}
			</Screen>
			<AccountSheets
				home={home}
				onDeleted={() => router.back()}
				onDone={() => void reload()}
				onTarget={setSheet}
				target={sheet}
			/>
		</>
	);
}
