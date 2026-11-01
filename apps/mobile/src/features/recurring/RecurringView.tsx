import { Stack } from "expo-router";
import { type ReactNode, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { AccountTopBar } from "@/features/account/AccountTopBar";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import {
	CategoryTile,
	ListGroup,
	ListRow,
	SectionHeader,
	StaleNote,
} from "@/ui/List";
import { MoneyAmount } from "@/ui/Money";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { SkeletonRows } from "@/ui/Skeleton";
import { StatusText } from "@/ui/StatusText";
import { SwipeRow } from "@/ui/SwipeRow";
import { Text } from "@/ui/Text";
import { ConfirmSheet, useDayText } from "./ConfirmSheet";
import { DeleteRecurringSheet } from "./DeleteRecurringSheet";
import {
	filterRecurring,
	isRecurringFiltered,
	NO_RECURRING_FILTER,
	type RecurringFilter,
} from "./filter";
import { groupsOf, isDue, type Period, type RecurringGroup } from "./groups";
import { ItemSheet } from "./ItemSheet";
import { AddRecurring } from "./RecurringComposer";
import { RecurringFilters } from "./RecurringFilters";
import { SkipSheet } from "./SkipSheet";
import {
	fetchRecurring,
	RECURRING_CACHE,
	type RecurringData,
	type RecurringItem,
} from "./source";

/** The line under the name: why it needs you, or when it comes and how often. */
function RowStatus({ item }: { item: RecurringItem }) {
	const t = useTranslations("mobile.recurring");
	const day = useDayText();
	if (item.paused) {
		return <StatusText label={t("status.paused")} size="sm" tone="muted" />;
	}
	if (item.state === "overdue") {
		return (
			<StatusText
				label={t("status.overdue", { date: day(item.next) })}
				size="sm"
				tone="attention"
				wrap
			/>
		);
	}
	if (item.state === "due") {
		return (
			<StatusText label={t("status.dueToday")} size="sm" tone="attention" />
		);
	}
	// Monthly is the usual: only another rhythm is worth saying.
	const text = [
		day(item.next),
		item.frequency === "monthly" ? null : t(`frequency.${item.frequency}`),
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<Text numberOfLines={1} tone="fg3" variant="meta">
			{text}
		</Text>
	);
}

function Row({
	item,
	onDetails,
	onConfirm,
	onSkip,
	onDelete,
}: {
	item: RecurringItem;
	onDetails: () => void;
	onConfirm: () => void;
	onSkip: () => void;
	onDelete: () => void;
}) {
	const t = useTranslations("mobile.recurring");
	const money = useMoneyText();
	const foreign = item.home !== undefined;
	const spoken = [
		item.title,
		item.paused ? t("status.paused") : t(`frequency.${item.frequency}`),
		money(item.amount),
		item.autoPay ? t("autoPayOn") : t("autoPayOff"),
	].join(", ");
	const due = isDue(item);
	const row = (
		<ListRow
			accessibilityLabel={spoken}
			end={
				<MoneyAmount
					home={foreign ? item.home : undefined}
					tone={
						item.paused
							? "muted"
							: item.direction === "in"
								? "positive"
								: "default"
					}
					value={item.amount}
				/>
			}
			lead={
				<CategoryTile
					category={
						item.category.name || item.category.icon ? item.category : null
					}
					fallback="Repeat"
				/>
			}
			// No press of its own: the SwipeRow around it owns the tap and the
			// long press, and an inner press would take the touch from the hold.
			sub={
				<View>
					<RowStatus item={item} />
					<Text numberOfLines={1} tone="fg3" variant="meta">
						{item.autoPay ? t("autoPayOn") : t("autoPayOff")}
					</Text>
				</View>
			}
			title={item.title}
		/>
	);
	// A paused template says Paused and its amount reads quiet.
	const remove = {
		id: "delete",
		label: t("delete.submit"),
		onPress: onDelete,
		destructive: true,
	};
	// One that is not due swipes left to Delete; a tap opens its details.
	if (!due)
		return (
			<SwipeRow
				menu={[
					{ id: "details", label: t("details"), onPress: onDetails },
					remove,
				]}
				menuTitle={item.title}
				onPress={onDetails}
				trailing={{
					label: t("delete.submit"),
					onPress: onDelete,
					tone: "danger",
				}}
			>
				{row}
			</SwipeRow>
		);
	// A due one swipes right to Confirm and left to Skip; a tap opens Confirm,
	// a long press the menu.
	return (
		<SwipeRow
			leading={{
				label: t("confirm.submit"),
				onPress: onConfirm,
				tone: "brand",
			}}
			menu={[
				{ id: "confirm", label: t("confirm.submit"), onPress: onConfirm },
				{ id: "skip", label: t("confirm.skip"), onPress: onSkip },
				{ id: "details", label: t("details"), onPress: onDetails },
				remove,
			]}
			menuTitle={item.title}
			onPress={onConfirm}
			trailing={{ label: t("skip.submit"), onPress: onSkip, tone: "neutral" }}
		>
			{row}
		</SwipeRow>
	);
}

/** A sentence with its money in bold: the message is split where the amount goes. */
function Emphasis({
	text,
	amount,
}: {
	text: (amount: string) => string;
	amount: string;
}) {
	const mark = "\u0000";
	const [before = "", after = ""] = text(mark).split(mark);
	return (
		<Text tone="fg2" variant="small">
			{before}
			<Text tabular tone="fg" variant="small" weight="semibold">
				{amount}
			</Text>
			{after}
		</Text>
	);
}

function Summary({ data }: { data: RecurringData }) {
	const t = useTranslations("mobile.recurring.summary");
	const money = useMoneyText();
	const { space } = useTheme();
	const [period, setPeriod] = useState<Period>("month");
	const { out, in: income } = data.summary;
	if (data.items.every((i) => i.paused)) return null;
	return (
		<View style={{ gap: space[2], padding: space[4] }}>
			<Emphasis
				amount={money(out[period])}
				text={(amount) => t(`out.${period}`, { amount })}
			/>
			{income ? (
				<Emphasis
					amount={money(income[period])}
					text={(amount) => t(`in.${period}`, { amount })}
				/>
			) : null}
			{out.missingRate.length > 0 ? (
				<Text tone="attention" variant="small">
					{t("missingRate", { currencies: out.missingRate.join(", ") })}
				</Text>
			) : null}
			<View style={{ paddingTop: space[1] }}>
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
	onDetails,
	onConfirm,
	onSkip,
	onDelete,
}: {
	groups: RecurringGroup[];
	onDetails: (item: RecurringItem) => void;
	onConfirm: (item: RecurringItem) => void;
	onSkip: (item: RecurringItem) => void;
	onDelete: (item: RecurringItem) => void;
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
					<ListGroup>
						{group.items.map((item) => (
							<Row
								item={item}
								key={item.id}
								onConfirm={() => onConfirm(item)}
								onDelete={() => onDelete(item)}
								onDetails={() => onDetails(item)}
								onSkip={() => onSkip(item)}
							/>
						))}
					</ListGroup>
				</View>
			))}
		</View>
	);
}

function Logged({ data }: { data: RecurringData }) {
	const t = useTranslations("mobile.recurring");
	const day = useDayText();
	const rows = data.summary.logged;
	if (rows.length === 0) return null;
	return (
		<View>
			<SectionHeader detail={String(rows.length)} title={t("logged.title")} />
			<ListGroup>
				{rows.map((row) => (
					<ListRow
						end={<MoneyAmount home={row.home} value={row.amount} />}
						key={row.id}
						lead={<CategoryTile category={row.category} fallback="Repeat" />}
						sub={day(row.date)}
						title={row.title}
					/>
				))}
			</ListGroup>
		</View>
	);
}

/**
 * Recurring expenses and income: how many, what they cost a month, the list
 * grouped by due date, and what auto-pay logged this month. A due item
 * confirms (tap, swipe right, long press) or skips (swipe left, long press);
 * any other opens its details
 * (auto-pay, pause, Delete). Delete is also the left swipe of a row that is
 * not due and in every row's menu; it opens the delete sheet. Adding opens the add sheet (the + in the top bar, or the
 * empty state); editing a template is on the web for now.
 * The count sits under the title, then the segments, the search and the chips.
 * `embedded` is Activity's Recurring segment: Activity owns the title and the
 * search (`query`), and `header` is the segmented control that stays above the
 * list; its owner draws the + (it passes `adding` and `onAdd` to open the
 * add sheet, `onAddClose` to close it).
 */
export function RecurringView({
	embedded = false,
	header,
	query = "",
	adding = false,
	onAdd,
	onAddClose,
}: {
	embedded?: boolean;
	header?: ReactNode;
	query?: string;
	adding?: boolean;
	onAdd?: () => void;
	onAddClose?: () => void;
}) {
	const t = useTranslations("mobile.recurring");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const { api } = useSession();
	const fetch = useMemo(() => (api ? fetchRecurring(api) : null), [api]);
	const { state, reload } = useCachedRead(RECURRING_CACHE, fetch);
	const [confirming, setConfirming] = useState<RecurringItem | null>(null);
	const [skipping, setSkipping] = useState<RecurringItem | null>(null);
	const [detail, setDetail] = useState<RecurringItem | null>(null);
	const [deleting, setDeleting] = useState<RecurringItem | null>(null);
	const [ownAdding, setOwnAdding] = useState(false);
	const isAdding = embedded ? adding : ownAdding;
	const openAdd = embedded ? (onAdd ?? (() => {})) : () => setOwnAdding(true);
	const closeAdd = embedded
		? (onAddClose ?? (() => {}))
		: () => setOwnAdding(false);

	const [chips, setChips] = useState<RecurringFilter>(NO_RECURRING_FILTER);
	const [own, setOwn] = useState("");
	const filter = { ...chips, q: embedded ? query : own };

	const title = embedded ? null : (
		<>
			<AccountTopBar
				actions={[
					{
						id: "add-recurring",
						icon: "Plus",
						label: t("add.title"),
						onPress: openAdd,
					},
				]}
				title={t("title")}
			/>
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						placeholder: t("search"),
						onChangeText: (event) => setOwn(event.nativeEvent.text),
					},
				}}
			/>
		</>
	);
	const addSheet = (
		<AddRecurring
			onClose={closeAdd}
			onDone={() => void reload()}
			visible={isAdding}
		/>
	);
	if (state.status !== "ready" || state.data.items.length === 0) {
		const failed = state.status === "error";
		const empty = state.status === "ready";
		return (
			<>
				{title}
				<Screen flush onRefresh={() => void reload()}>
					{header}
					{!failed && !empty ? (
						<SkeletonRows count={4} />
					) : (
						<EmptyState
							actionLabel={failed ? tc("retry") : t("add.title")}
							detail={failed ? t("errorDetail") : t("emptyDetail")}
							onAction={failed ? () => void reload() : openAdd}
							title={failed ? t("error") : t("empty")}
						/>
					)}
				</Screen>
				{addSheet}
			</>
		);
	}
	const data = state.data;
	const shown = filterRecurring(data.items, filter);
	const groups = groupsOf(shown, data.summary.today);
	return (
		<>
			{title}
			<Screen flush onRefresh={() => void reload()}>
				{/* The tabs lead, as in the other segment, so a switch moves nothing. */}
				{header}
				<View style={{ paddingHorizontal: space[4] }}>
					<Text tone="fg2" variant="small">
						{t("count", { count: data.items.length })}
					</Text>
				</View>
				<StaleNote since={state.staleSince} />
				<RecurringFilters filter={chips} onChange={setChips} />
				<Summary data={data} />
				{shown.length === 0 && isRecurringFiltered(filter) ? (
					<EmptyState title={t("emptyFiltered")} />
				) : (
					<Groups
						groups={groups}
						onConfirm={setConfirming}
						onDelete={setDeleting}
						onDetails={setDetail}
						onSkip={setSkipping}
					/>
				)}
				<Logged data={data} />
			</Screen>
			{confirming ? (
				<ConfirmSheet
					item={confirming}
					onClose={() => setConfirming(null)}
					onDone={() => void reload()}
					onSkip={() => {
						setSkipping(confirming);
						setConfirming(null);
					}}
					today={data.summary.today}
					visible
				/>
			) : null}
			{skipping ? (
				<SkipSheet
					item={skipping}
					onClose={() => setSkipping(null)}
					onDone={() => void reload()}
					visible
				/>
			) : null}
			{detail ? (
				<ItemSheet
					item={detail}
					onClose={() => setDetail(null)}
					onDelete={() => {
						setDeleting(detail);
						setDetail(null);
					}}
					onDone={() => void reload()}
					visible
				/>
			) : null}
			{deleting ? (
				<DeleteRecurringSheet
					item={deleting}
					onClose={() => setDeleting(null)}
					onDone={() => void reload()}
					visible
				/>
			) : null}
			{addSheet}
		</>
	);
}
