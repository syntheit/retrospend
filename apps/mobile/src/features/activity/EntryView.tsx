import { Stack } from "expo-router";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { DetailActions } from "@/ui/DetailActions";
import { EmptyState } from "@/ui/EmptyState";
import { StaleNote } from "@/ui/List";
import { PaneBar } from "@/ui/PaneBar";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { useEntryActions } from "./EntryActions";
import { EntryFacts } from "./EntryFacts";
import { EntryHead } from "./EntryHead";
import { EntryShares } from "./EntryShares";
import type { ActivityItem } from "./source";
import { useEntryDetail } from "./useEntryDetail";
import { useEntryRow } from "./useEntryRow";

/**
 * One entry by its Activity id, read from the server. What the list passed
 * shows while the server answers, without actions; a deleted entry says so.
 * `titled` is the pushed page: it names itself in the bar ("Expense", "Income",
 * "Payment"); in a list-detail pane the pane has no bar.
 */
export function EntryDetail({
	id,
	placeholder,
	titled = false,
}: {
	id: string;
	placeholder: ActivityItem | null;
	titled?: boolean;
}) {
	const t = useTranslations("mobile.entry");
	const { state, reload } = useEntryRow(id, placeholder);
	const tc = useTranslations("mobile.common");
	if (state.status === "loading") {
		return state.placeholder ? (
			<EntryView editable={false} item={state.placeholder} titled={titled} />
		) : (
			<SkeletonRows count={3} grouped={false} />
		);
	}
	if (state.status === "missing") return <EmptyState title={t("gone")} />;
	if (state.status === "error") {
		return (
			<EmptyState
				actionLabel={tc("retry")}
				detail={t("loadErrorDetail")}
				onAction={() => void reload()}
				title={t("loadError")}
			/>
		);
	}
	return (
		<EntryView
			editable={state.staleSince === null}
			item={state.item}
			staleSince={state.staleSince}
			titled={titled}
		/>
	);
}

/**
 * The read view of one entry (the mockup's entry sheet): the head (tile,
 * title, amount, "≈ home"), the facts, the shares of a split, notes, and the
 * actions. A personal expense reads its notes, place and spread from GET
 * /expenses/{id}, a split reads who paid and each share from GET
 * /shared-expenses/{id}; a payment shows what the list row carries.
 */
export function EntryView({
	item,
	editable = true,
	staleSince = null,
	titled = false,
}: {
	item: ActivityItem;
	/** False while the row is a placeholder or a stale copy: actions wait for the server's. */
	editable?: boolean;
	/** When the row was read, if the server could not be reached since. */
	staleSince?: string | null;
	titled?: boolean;
}) {
	const t = useTranslations("mobile.entry");
	const { space } = useTheme();
	const detail = useEntryDetail(item);
	const actions = useEntryActions({
		item,
		editable,
		onChanged: detail.reload,
		// Waits for the server's detail: only it knows whether a template exists.
		repeating:
			detail.personal === null || detail.personal.recurringTemplateId !== null,
	});
	// Edit is the pencil in the header, with the overflow menu after it: a
	// pushed page's bar, or the pane's.
	const header = (
		<DetailActions
			edit={actions.edit}
			editLabel={t("edit")}
			items={actions.menu}
			moreLabel={t("more")}
		/>
	);
	const heading =
		item.kind === "income"
			? t("titleIncome")
			: item.kind === "payment"
				? t("titlePayment")
				: t("title");
	const note = detail.personal?.description ?? detail.shared?.notes ?? null;
	const addedBy =
		detail.shared && !detail.shared.createdBy.you
			? detail.shared.createdBy.name.trim().split(/\s+/)[0]
			: null;

	return (
		<View style={{ gap: space[2], paddingBottom: space[8] }}>
			{titled ? (
				<Stack.Screen
					options={{
						title: heading,
						headerLargeTitle: false,
						headerRight: () => header,
					}}
				/>
			) : (
				<PaneBar title={heading} trailing={header} />
			)}
			<EntryHead item={item} />
			<EntryFacts extra={detail.personal} item={item} />
			{detail.shared ? <EntryShares detail={detail.shared} /> : null}
			{note ? <Text tone="fg2">{note}</Text> : null}
			{addedBy ? (
				<Text tone="fg3" variant="meta">
					{t("addedBy", { name: addedBy })}
				</Text>
			) : null}
			<StaleNote since={staleSince ?? detail.staleSince} />
			{actions.sheets}
		</View>
	);
}
