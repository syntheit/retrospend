import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { MoneyAmount } from "@/features/read/MoneyAmount";
import {
	CategoryTile,
	ListRow,
	SectionHeader,
	StaleNote,
} from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { ConfirmSheet, useDayText } from "./ConfirmSheet";
import {
	daysBetween,
	groupsOf,
	isDue,
	type Period,
	type RecurringGroup,
} from "./groups";
import { ItemSheet } from "./ItemSheet";
import {
	fetchRecurring,
	RECURRING_CACHE,
	type RecurringData,
	type RecurringItem,
} from "./source";

function Status({ item, today }: { item: RecurringItem; today: string }) {
	const t = useTranslations("mobile.recurring.status");
	const { color, type } = useTheme();
	const day = useDayText();
	const days = daysBetween(today, item.next);
	let text: string;
	let tone = color.fg2;
	if (item.paused) text = t("paused");
	else if (item.state === "overdue") {
		text = t("overdue", { date: day(item.next) });
		tone = color.attentionText;
	} else if (item.state === "due") {
		text = t("dueToday");
		tone = color.attentionText;
	} else text = t("upcoming", { date: day(item.next), days });
	return (
		<Text numberOfLines={1} style={{ color: tone, fontSize: type.small.size }}>
			{text}
		</Text>
	);
}

function Row({
	item,
	today,
	onPress,
}: {
	item: RecurringItem;
	today: string;
	onPress: () => void;
}) {
	const t = useTranslations("mobile.recurring");
	const { color, space, type } = useTheme();
	const money = useMoneyText();
	const foreign = item.home !== undefined;
	const spoken = [
		item.title,
		item.paused ? t("status.paused") : t(`frequency.${item.frequency}`),
		money(item.amount),
	].join(", ");
	return (
		<ListRow accessibilityLabel={spoken} onPress={onPress}>
			<CategoryTile
				category={
					item.category.name || item.category.icon ? item.category : null
				}
				fallback="Repeat"
			/>
			<View style={{ flex: 1, gap: space[1], opacity: item.paused ? 0.6 : 1 }}>
				<Text
					numberOfLines={1}
					style={{ color: color.fg, fontSize: type.body.size }}
				>
					{item.title}
				</Text>
				<Status item={item} today={today} />
				<Text
					numberOfLines={1}
					style={{ color: color.fg2, fontSize: type.small.size }}
				>
					{[
						t(`frequency.${item.frequency}`),
						item.autoPay ? t("autoPay") : null,
					]
						.filter(Boolean)
						.join(" · ")}
				</Text>
			</View>
			<MoneyAmount
				home={foreign ? item.home : undefined}
				tone={item.direction === "in" ? "positive" : "default"}
				value={item.amount}
			/>
		</ListRow>
	);
}

function Summary({ data }: { data: RecurringData }) {
	const t = useTranslations("mobile.recurring.summary");
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const [period, setPeriod] = useState<Period>("month");
	const { out, in: income } = data.summary;
	if (data.items.every((i) => i.paused)) return null;
	return (
		<View style={{ gap: space[3], padding: space[4] }}>
			<Text style={{ color: color.fg, fontSize: type.body.size }}>
				{t(`out.${period}`, { amount: money(out[period]) })}
			</Text>
			{income ? (
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t(`in.${period}`, { amount: money(income[period]) })}
				</Text>
			) : null}
			{out.missingRate.length > 0 ? (
				<Text style={{ color: color.attentionText, fontSize: type.small.size }}>
					{t("missingRate", { currencies: out.missingRate.join(", ") })}
				</Text>
			) : null}
			<View style={{ paddingVertical: space[1] }}>
				<Segmented
					accessibilityLabel={t("period")}
					onChange={setPeriod}
					options={[
						{ value: "month", label: t("monthly") },
						{ value: "quarter", label: t("quarterly") },
						{ value: "year", label: t("yearly") },
					]}
					value={period}
				/>
			</View>
		</View>
	);
}

function Groups({
	groups,
	today,
	onOpen,
}: {
	groups: RecurringGroup[];
	today: string;
	onOpen: (item: RecurringItem) => void;
}) {
	const t = useTranslations("mobile.recurring.groups");
	return (
		<View>
			{groups.map((group) => (
				<View key={group.id}>
					<SectionHeader
						detail={String(group.items.length)}
						title={t(group.id)}
					/>
					{group.items.map((item) => (
						<Row
							item={item}
							key={item.id}
							onPress={() => onOpen(item)}
							today={today}
						/>
					))}
				</View>
			))}
		</View>
	);
}

function Logged({ data }: { data: RecurringData }) {
	const t = useTranslations("mobile.recurring");
	const day = useDayText();
	const { color, space, type } = useTheme();
	const rows = data.summary.logged;
	if (rows.length === 0) return null;
	return (
		<View>
			<SectionHeader detail={String(rows.length)} title={t("logged.title")} />
			{rows.map((row) => (
				<ListRow key={row.id}>
					<CategoryTile category={row.category} fallback="Repeat" />
					<View style={{ flex: 1, gap: space[1] }}>
						<Text
							numberOfLines={1}
							style={{ color: color.fg, fontSize: type.body.size }}
						>
							{row.title}
						</Text>
						<Text style={{ color: color.fg2, fontSize: type.small.size }}>
							{day(row.date)}
						</Text>
					</View>
					<MoneyAmount home={row.home} value={row.amount} />
				</ListRow>
			))}
		</View>
	);
}

/**
 * Recurring expenses and income: what they cost a month, the list grouped by
 * due date, and what auto-pay logged this month. A due item opens Confirm,
 * any other opens its details (auto-pay, pause). Adding and editing a
 * template are on the web for now.
 */
export function RecurringView() {
	const t = useTranslations("mobile.recurring");
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchRecurring(api) : null), [api]);
	const { state, reload } = useCachedRead(RECURRING_CACHE, fetch);
	const [confirming, setConfirming] = useState<RecurringItem | null>(null);
	const [detail, setDetail] = useState<RecurringItem | null>(null);

	const title = <Stack.Screen options={{ title: t("title") }} />;
	if (state.status !== "ready") {
		return (
			<>
				{title}
				<Screen>
					<EmptyState
						detail={state.status === "error" ? t("errorDetail") : undefined}
						title={state.status === "error" ? t("error") : loading}
					/>
				</Screen>
			</>
		);
	}
	const data = state.data;
	if (data.items.length === 0) {
		return (
			<>
				{title}
				<Screen>
					<EmptyState detail={t("emptyDetail")} title={t("empty")} />
				</Screen>
			</>
		);
	}
	const groups = groupsOf(data.items, data.summary.today);
	return (
		<>
			{title}
			<Screen flush>
				<StaleNote since={state.staleSince} />
				<Summary data={data} />
				<Groups
					groups={groups}
					onOpen={(item) =>
						isDue(item) ? setConfirming(item) : setDetail(item)
					}
					today={data.summary.today}
				/>
				<Logged data={data} />
			</Screen>
			{confirming ? (
				<ConfirmSheet
					item={confirming}
					onClose={() => setConfirming(null)}
					onDone={() => void reload()}
					visible
				/>
			) : null}
			{detail ? (
				<ItemSheet
					item={detail}
					onClose={() => setDetail(null)}
					onDone={() => void reload()}
					visible
				/>
			) : null}
		</>
	);
}
