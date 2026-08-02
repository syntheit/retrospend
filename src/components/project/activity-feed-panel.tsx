"use client";

import {
	Check,
	CheckCircle,
	Circle,
	Clock,
	ListFilter,
	Lock,
	Loader2,
	Pencil,
	Plus,
	PlusCircle,
	Shield,
	Trash2,
	UserMinus,
	UserPlus,
	XCircle,
	ArrowRight,
	Activity,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ComponentType,
} from "react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { UserAvatar } from "~/components/ui/user-avatar";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "~/lib/utils";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import { useRevisionHistory } from "~/components/revision-history-provider";
import { groupConsecutiveEntries, type EntryGroup } from "~/lib/activity-utils";

// ── Types ──────────────────────────────────────────────────────────────────

type ActivityFeedOutput = RouterOutputs["auditLog"]["projectActivityFeed"];
type ActivityEntry = ActivityFeedOutput["entries"][number];
type ActivityFiltersOutput = RouterOutputs["auditLog"]["projectActivityFilters"];
type FeedFilters = NonNullable<RouterInputs["auditLog"]["projectActivityFeed"]["filters"]>;

type FieldChange = Extract<
	NonNullable<ActivityEntry["detail"]>,
	{ type: "field_changes" }
>["changes"][number];
type Snapshot = Extract<
	NonNullable<ActivityEntry["detail"]>,
	{ type: "creation_snapshot" }
>["snapshot"];

// ── Client-side Relative Time ────────────────────────────────────────────────

function translateRelativeTime(
	timestamp: string,
	t: ReturnType<typeof useTranslations<"projects">>,
): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return t("relativeJustNow");
	if (diffMins < 60) return t("relativeMinutesAgo", { count: diffMins });
	if (diffHours < 24) return t("relativeHoursAgo", { count: diffHours });
	if (diffDays === 1) return t("relativeYesterday");
	if (diffDays < 30) return t("relativeDaysAgo", { count: diffDays });
	if (diffDays < 365) {
		const months = Math.floor(diffDays / 30);
		return t("relativeMonthsAgo", { count: months });
	}
	const years = Math.floor(diffDays / 365);
	return t("relativeYearsAgo", { count: years });
}

// ── Client-side Activity Summary Translation ────────────────────────────────

/**
 * Generates a translated one-line summary for an activity entry using
 * the structured data the server returns. Falls back to the pre-generated
 * English `entry.summary` when structured data is insufficient.
 */
function translateActivitySummary(
	entry: ActivityEntry,
	t: ReturnType<typeof useTranslations<"projects">>,
): string {
	// Use server-provided summaryKey + summaryParams when available
	if (entry.summaryKey && entry.summaryParams) {
		try {
			return t(entry.summaryKey as Parameters<typeof t>[0], entry.summaryParams);
		} catch {
			// Fall through to English summary
		}
	}
	return entry.summary;
}

// ── Filter Group Definitions ────────────────────────────────────────────────

type FilterGroup = {
	label: string;
	actions: string[];
};

const FILTER_GROUP_DEFS = [
	{ key: "added", actions: ["CREATED"] },
	{ key: "edited", actions: ["EDITED"] },
	{ key: "deleted", actions: ["DELETED"] },
	{ key: "verified", actions: ["VERIFIED", "AUTO_VERIFIED", "REJECTED"] },
	{ key: "settled", actions: ["SETTLED"] },
	{ key: "period", actions: ["PERIOD_CLOSED"] },
	{ key: "members", actions: ["PARTICIPANT_ADDED", "PARTICIPANT_REMOVED", "ROLE_CHANGED"] },
] as const;

function getFilterGroups(t: ReturnType<typeof useTranslations<"projects">>): FilterGroup[] {
	const labels: Record<string, string> = {
		added: t("filterAdded"),
		edited: t("filterEdited"),
		deleted: t("filterDeleted"),
		verified: t("filterVerified"),
		settled: t("filterSettled"),
		period: t("filterPeriod"),
		members: t("filterMembers"),
	};
	return FILTER_GROUP_DEFS.map((d) => ({ label: labels[d.key]!, actions: [...d.actions] }));
}

function getFilterGroupCount(
	group: FilterGroup,
	actionTypes: ActivityFiltersOutput["actionTypes"],
): number {
	return group.actions.reduce((sum, action) => {
		const found = actionTypes.find((a) => a.value === action);
		return sum + (found?.count ?? 0);
	}, 0);
}

// ── Icon & Color Mapping ────────────────────────────────────────────────────

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
	"plus-circle": PlusCircle,
	plus: Plus,
	pencil: Pencil,
	check: Check,
	"check-circle": CheckCircle,
	"x-circle": XCircle,
	clock: Clock,
	trash: Trash2,
	lock: Lock,
	"user-plus": UserPlus,
	"user-minus": UserMinus,
	shield: Shield,
	"arrow-right": ArrowRight,
	activity: Activity,
	circle: Circle,
};

const colorStyles: Record<string, { bg: string; fg: string }> = {
	green: {
		bg: "bg-emerald-500/15",
		fg: "text-emerald-600 dark:text-emerald-400",
	},
	amber: {
		bg: "bg-amber-500/15",
		fg: "text-amber-600 dark:text-amber-400",
	},
	blue: {
		bg: "bg-blue-500/15",
		fg: "text-blue-600 dark:text-blue-400",
	},
	red: {
		bg: "bg-rose-500/15",
		fg: "text-rose-600 dark:text-rose-400",
	},
	sky: {
		bg: "bg-sky-500/15",
		fg: "text-sky-600 dark:text-sky-400",
	},
	gray: {
		bg: "bg-muted",
		fg: "text-muted-foreground",
	},
};

const defaultColor = colorStyles.gray!;

// ── Loading Skeleton ────────────────────────────────────────────────────────

function FeedSkeleton() {
	return (
		<div className="space-y-4 pt-2">
			{[0, 1, 2, 3, 4].map((i) => (
				<div className="flex gap-3" key={i}>
					<Skeleton
						className="h-8 w-8 shrink-0 rounded-full"
						style={{ animationDelay: `${i * 50}ms` }}
					/>
					<div className="flex-1 space-y-2">
						<Skeleton
							className="h-4 w-3/4"
							style={{ animationDelay: `${i * 50}ms` }}
						/>
						<Skeleton
							className="h-3 w-1/3"
							style={{ animationDelay: `${i * 50}ms` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

// ── Field Change Components (reused from revision-history-drawer) ───────────

function FieldChangeRow({ change }: { change: FieldChange; }) {
	const t = useTranslations("projects");
	if (change.field === "participant_added") {
		return (
			<div className="px-3 py-2">
				<div className="flex items-center gap-1.5 text-sm">
					<span className="text-muted-foreground">+</span>
					<span>{change.label}</span>
				</div>
				{change.newValue && (
					<div className="mt-0.5 text-muted-foreground text-xs">
						{change.newValue}
					</div>
				)}
			</div>
		);
	}

	if (change.field === "participant_removed") {
		return (
			<div className="px-3 py-2">
				<div className="flex items-center gap-1.5 text-sm">
					<span className="text-muted-foreground">&minus;</span>
					<span className="text-muted-foreground line-through">
						{change.label}
					</span>
				</div>
				{change.oldValue && (
					<div className="mt-0.5 text-muted-foreground text-xs">
						{t("snapshotWas", { value: change.oldValue })}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="px-3 py-2">
			<div className="font-medium text-muted-foreground text-xs tracking-wide">
				{change.label}
			</div>
			<div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
				<span className="text-muted-foreground line-through">
					{change.oldValue}
				</span>
				<span className="text-muted-foreground">&rarr;</span>
				<span>{change.newValue}</span>
			</div>
		</div>
	);
}

function FieldChangeList({ changes }: { changes: FieldChange[] }) {
	return (
		<div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted/40">
			{changes.map((change, i) => (
				<div key={`${change.field}-${i}`}>
					{i > 0 && <div className="border-border border-t" />}
					<FieldChangeRow change={change} />
				</div>
			))}
		</div>
	);
}

function SnapshotView({
	snapshot,
	isDeleted,
}: {
	snapshot: Snapshot;
	isDeleted?: boolean;
}) {
	const t = useTranslations("projects");
	const participants = snapshot.participants
		.map((p) => `${p.name} (${p.share})`)
		.join(", ");

	return (
		<div
			className={cn(
				"mt-2 space-y-0.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground/80 text-xs",
				isDeleted && "opacity-75",
			)}
		>
			<div>
				{snapshot.amount} {snapshot.currency} &middot; {snapshot.splitMode}{" "}
				{t("snapshotSplit")}
			</div>
			<div>{t("snapshotPaidBy", { name: snapshot.paidBy })}</div>
			{participants && <div>{participants}</div>}
			{isDeleted && <div className="mt-1 italic">{t("snapshotExpenseDeleted")}</div>}
		</div>
	);
}

function EntryDetail({ detail }: { detail: NonNullable<ActivityEntry["detail"]> }) {
	switch (detail.type) {
		case "field_changes":
			return <FieldChangeList changes={detail.changes} />;
		case "creation_snapshot":
			return <SnapshotView snapshot={detail.snapshot} />;
		case "deletion_snapshot":
			return <SnapshotView isDeleted snapshot={detail.snapshot} />;
		case "rejection":
			return detail.reason ? (
				<div className="mt-2 rounded-md border-rose-500/50 border-l-2 bg-muted/30 px-3 py-2 text-muted-foreground text-sm italic">
					&ldquo;{detail.reason}&rdquo;
				</div>
			) : null;
		case "verification":
			return detail.note ? (
				<div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
					{detail.note}
				</div>
			) : null;
		default:
			return null;
	}
}

// ── Date Separator ──────────────────────────────────────────────────────────

function getDateLabel(dateStr: string, t: ReturnType<typeof useTranslations<"projects">>, locale: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const entryDate = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	);
	const diffDays = Math.floor(
		(today.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24),
	);

	if (diffDays === 0) return t("dateToday");
	if (diffDays === 1) return t("dateYesterday");
	return date.toLocaleDateString(locale, {
		month: "long",
		day: "numeric",
		year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
	});
}

function DateSeparator({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-3 py-3">
			<div className="h-px flex-1 bg-border" />
			<span className="text-muted-foreground text-xs font-medium shrink-0">
				{label}
			</span>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

// ── Activity Entry ──────────────────────────────────────────────────────────

function ActivityEntryView({
	entry,
	onViewFullHistory,
}: {
	entry: ActivityEntry;
	onViewFullHistory?: (transactionId: string) => void;
}) {
	const t = useTranslations("projects");
	const [expanded, setExpanded] = useState(false);
	const c = colorStyles[entry.action.color] ?? defaultColor;
	const Icon = iconMap[entry.action.icon] ?? Circle;
	const hasDetail = entry.detail !== null;
	const isTransactionEntry =
		entry.target.type === "transaction" && entry.target.id;

	// Generate translated summary and parse to bold the actor name
	const translatedSummary = useMemo(
		() => translateActivitySummary(entry, t),
		[entry, t],
	);

	const summaryParts = useMemo(() => {
		const actorName = entry.actor.name;
		const idx = translatedSummary.indexOf(actorName);
		if (idx === -1) return { before: "", actor: "", after: translatedSummary };
		return {
			before: translatedSummary.slice(0, idx),
			actor: actorName,
			after: translatedSummary.slice(idx + actorName.length),
		};
	}, [translatedSummary, entry.actor.name]);

	// For edits, show first field change as inline preview
	const inlinePreview = useMemo(() => {
		if (
			entry.detail?.type !== "field_changes" ||
			!entry.detail.changes.length
		)
			return null;
		const first = entry.detail.changes[0]!;
		if (
			first.field === "participant_added" ||
			first.field === "participant_removed"
		)
			return null;
		const moreCount = entry.detail.changes.length - 1;
		return { change: first, moreCount };
	}, [entry.detail]);

	return (
		<div
			className={cn(
				"group flex gap-3 rounded-lg px-2 py-2 transition-colors",
				hasDetail && "cursor-pointer hover:bg-muted/50",
			)}
			onClick={hasDetail ? () => setExpanded(!expanded) : undefined}
		>
			{/* Avatar or action icon */}
			{entry.actor.type !== "system" ? (
				<div className="relative shrink-0">
					<UserAvatar
						avatarUrl={entry.actor.avatarUrl}
						name={entry.actor.name}
						size="sm"
					/>
					<div
						className={cn(
							"absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background",
							c.bg,
						)}
					>
						<Icon className={cn("h-2.5 w-2.5", c.fg)} />
					</div>
				</div>
			) : (
				<div
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
						c.bg,
					)}
				>
					<Icon className={cn("h-4 w-4", c.fg)} />
				</div>
			)}

			{/* Content */}
			<div className="min-w-0 flex-1">
				<p className="text-sm leading-snug">
					{summaryParts.before}
					<span className="font-semibold">{summaryParts.actor}</span>
					{summaryParts.after}
				</p>

				{/* Inline preview for edits (when collapsed) */}
				{!expanded && inlinePreview && (
					<p className="mt-0.5 text-muted-foreground text-xs">
						{inlinePreview.change.label}: {inlinePreview.change.oldValue}{" "}
						&rarr; {inlinePreview.change.newValue}
						{inlinePreview.moreCount > 0 && (
							<span className="text-muted-foreground/70">
								{" "}
								{t("andMoreChanges", { count: inlinePreview.moreCount })}
							</span>
						)}
					</p>
				)}

				{/* Expanded detail */}
				{expanded && entry.detail && (
					<EntryDetail detail={entry.detail} />
				)}

				{/* Timestamp + view full history link */}
				<div className="mt-1 flex items-center gap-2">
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="cursor-default text-muted-foreground text-xs">
								{translateRelativeTime(entry.timestamp, t)}
							</span>
						</TooltipTrigger>
						<TooltipContent>
							{new Date(entry.timestamp).toLocaleString("en-US", {
								month: "short",
								day: "numeric",
								year: "numeric",
								hour: "numeric",
								minute: "2-digit",
								hour12: true,
							})}
						</TooltipContent>
					</Tooltip>
					{expanded && isTransactionEntry && onViewFullHistory && (
						<Button
							className="h-auto p-0 text-xs"
							onClick={(e) => {
								e.stopPropagation();
								onViewFullHistory(entry.target.id);
							}}
							type="button"
							variant="link"
						>
							{t("viewFullHistory")}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Grouped Entry View ──────────────────────────────────────────────────────

function ActivityGroupView({
	group,
	onViewFullHistory,
}: {
	group: EntryGroup;
	onViewFullHistory?: (transactionId: string) => void;
}) {
	const t = useTranslations("projects");
	const [groupExpanded, setGroupExpanded] = useState(false);
	const additionalCount = group.entries.length - 1;

	return (
		<div>
			<ActivityEntryView
				entry={group.entries[0]!}
				onViewFullHistory={onViewFullHistory}
			/>
			{additionalCount > 0 && (
				<div className="ml-11 -mt-1 mb-2">
					<Button
						className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
						onClick={() => setGroupExpanded(!groupExpanded)}
						type="button"
						variant="ghost"
						size="sm"
					>
						{groupExpanded
							? t("hideRepeatedEvents")
							: t("repeatedEvents", { count: additionalCount })}
					</Button>
					{groupExpanded &&
						group.entries.slice(1).map((entry) => (
							<ActivityEntryView
								entry={entry}
								key={entry.id}
								onViewFullHistory={onViewFullHistory}
							/>
						))}
				</div>
			)}
		</div>
	);
}

// ── Action Type Filter Chips ────────────────────────────────────────────────

function ActionFilterChips({
	selectedGroups,
	onToggleGroup,
	actionTypes,
	filterGroups,
}: {
	selectedGroups: Set<string>;
	onToggleGroup: (label: string) => void;
	actionTypes: ActivityFiltersOutput["actionTypes"];
	filterGroups: FilterGroup[];
}) {
	const t = useTranslations("projects");
	const isAll = selectedGroups.size === 0;

	return (
		<div className="flex flex-wrap gap-1.5">
			<Button
				aria-pressed={isAll}
				className="h-7 px-2.5 text-xs"
				onClick={() => onToggleGroup("__all__")}
				size="sm"
				variant={isAll ? "default" : "outline"}
			>
				{t("filterAll")}
			</Button>
			{filterGroups.map((group) => {
				const count = getFilterGroupCount(group, actionTypes);
				if (count === 0) return null;
				const isSelected = selectedGroups.has(group.label);
				return (
					<Button
						aria-pressed={isSelected}
						className="h-7 px-2.5 text-xs"
						key={group.label}
						onClick={() => onToggleGroup(group.label)}
						size="sm"
						variant={isSelected ? "default" : "outline"}
					>
						{group.label}
						<span className="ml-1 tabular-nums opacity-60">{count}</span>
					</Button>
				);
			})}
		</div>
	);
}

// ── Person Filter ───────────────────────────────────────────────────────────

function PersonFilter({
	actors,
	selectedActorIds,
	onToggleActor,
}: {
	actors: ActivityFiltersOutput["actors"];
	selectedActorIds: Set<string>;
	onToggleActor: (actorId: string) => void;
}) {
	const t = useTranslations("projects");
	if (actors.length <= 1) return null;

	const selectedCount = selectedActorIds.size;
	const label =
		selectedCount === 0
			? t("allPeople")
			: selectedCount === 1
				? actors.find((a) => selectedActorIds.has(a.id))?.name ?? t("onePerson")
				: t("countPeople", { count: selectedCount });

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className="h-7 text-xs gap-1.5" size="sm" variant="outline">
					<ListFilter className="h-3.5 w-3.5" />
					{t("peopleLabel")}: {label}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				{actors.map((actor) => (
					<DropdownMenuCheckboxItem
						checked={selectedActorIds.has(actor.id)}
						key={actor.id}
						onCheckedChange={() => onToggleActor(actor.id)}
					>
						<div className="flex items-center gap-2">
							<UserAvatar
								avatarUrl={actor.avatarUrl}
								name={actor.name}
								size="xs"
							/>
							<span className="flex-1 truncate">{actor.name}</span>
						</div>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ── Activity Feed (shared body) ─────────────────────────────────────────────
//
// Filters + list + infinite scroll, with no surrounding chrome. Rendered
// directly in the project's Activity tab (ActivityTab). `onClose` lets the
// "view full history" action dismiss whatever container is showing the feed
// before opening the revision drawer; in the tab there is nothing to close, so
// it's a no-op. The "sheet" layout is kept for callers that host the feed in a
// side panel.

interface ActivityFeedProps {
	projectId: string;
	/** Called before opening revision history (closes the Sheet when applicable). */
	onClose?: () => void;
	/** Optional slot rendered inside the header block (e.g. the Sheet's title). */
	header?: React.ReactNode;
	/** Layout: "sheet" keeps the sticky-header split; "panel" is a plain block. */
	layout?: "sheet" | "panel";
	/** Reports the total event count so containers can render it in their chrome. */
	onTotalCountChange?: (count: number) => void;
}

export function ActivityFeed({
	projectId,
	onClose,
	header,
	layout = "panel",
	onTotalCountChange,
}: ActivityFeedProps) {
	const t = useTranslations("projects");
	const { openHistory } = useRevisionHistory();
	const filterGroups = useMemo(() => getFilterGroups(t), [t]);
	const locale = useLocale();

	// Filter state
	const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
	const [selectedActorIds, setSelectedActorIds] = useState<Set<string>>(
		new Set(),
	);

	// Compute the AuditAction[] from selected filter groups
	const activeActions = useMemo(() => {
		if (selectedGroups.size === 0) return undefined;
		const actions: string[] = [];
		for (const group of filterGroups) {
			if (selectedGroups.has(group.label)) {
				actions.push(...group.actions);
			}
		}
		return actions.length > 0 ? actions : undefined;
	}, [selectedGroups, filterGroups]);

	// Pick first selected actor for the query (backend supports single actor filter)
	const selectedActorArr = useMemo(
		() => [...selectedActorIds],
		[selectedActorIds],
	);

	// Filters query
	const { data: filtersData } = api.auditLog.projectActivityFilters.useQuery(
		{ projectId },
	);

	// Build the filters object for the query
	const queryFilters = useMemo((): FeedFilters | undefined => {
		const f: FeedFilters = {};

		if (activeActions?.length) {
			f.actions = activeActions as FeedFilters["actions"];
		}

		if (selectedActorArr.length === 1 && filtersData) {
			const actor = filtersData.actors.find(
				(a) => a.id === selectedActorArr[0],
			);
			if (actor) {
				f.actorId = actor.id;
				f.actorType = actor.type as FeedFilters["actorType"];
			}
		}

		return Object.keys(f).length > 0 ? f : undefined;
	}, [activeActions, selectedActorArr, filtersData]);

	// Activity feed query
	const {
		data: feedData,
		isLoading,
		isError,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = api.auditLog.projectActivityFeed.useInfiniteQuery(
		{
			projectId,
			limit: 50,
			filters: queryFilters,
		},
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			initialCursor: undefined,
		},
	);

	// Flatten paginated entries
	const allEntries = useMemo(
		() => feedData?.pages.flatMap((p) => p.entries) ?? [],
		[feedData],
	);
	const totalCount = feedData?.pages[0]?.totalCount ?? 0;

	// Bubble the count up so the containing chrome (Sheet header) can show it.
	useEffect(() => {
		onTotalCountChange?.(totalCount);
	}, [totalCount, onTotalCountChange]);

	// Filter handlers
	const toggleGroup = useCallback((label: string) => {
		if (label === "__all__") {
			setSelectedGroups(new Set());
			return;
		}
		setSelectedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(label)) {
				next.delete(label);
			} else {
				next.add(label);
			}
			return next;
		});
	}, []);

	const toggleActor = useCallback((actorId: string) => {
		setSelectedActorIds((prev) => {
			const next = new Set(prev);
			if (next.has(actorId)) {
				next.delete(actorId);
			} else {
				next.add(actorId);
			}
			return next;
		});
	}, []);

	const clearFilters = useCallback(() => {
		setSelectedGroups(new Set());
		setSelectedActorIds(new Set());
	}, []);

	const hasActiveFilters = selectedGroups.size > 0 || selectedActorIds.size > 0;

	// Handle "View full history" - close activity feed, open revision history
	const handleViewFullHistory = useCallback(
		(transactionId: string) => {
			if (onClose) {
				onClose();
				// Small delay to let the sheet close animation start
				setTimeout(() => openHistory(transactionId), 150);
			} else {
				openHistory(transactionId);
			}
		},
		[onClose, openHistory],
	);

	// Group consecutive entries, then insert date separators
	const entriesWithSeparators = useMemo(() => {
		const groups = groupConsecutiveEntries(allEntries);
		const result: Array<
			| { type: "separator"; label: string; key: string }
			| { type: "group"; group: EntryGroup; key: string }
		> = [];

		let lastDateLabel = "";
		for (const group of groups) {
			const dateLabel = getDateLabel(group.entries[0]!.timestamp, t, locale);
			if (dateLabel !== lastDateLabel) {
				lastDateLabel = dateLabel;
				result.push({
					type: "separator",
					label: dateLabel,
					key: `sep-${dateLabel}`,
				});
			}
			result.push({ type: "group", group, key: group.key });
		}
		return result;
	}, [allEntries]);

	const filtersBlock = filtersData ? (
		<div className="space-y-2 pt-2">
			<ActionFilterChips
				actionTypes={filtersData.actionTypes}
				filterGroups={filterGroups}
				onToggleGroup={toggleGroup}
				selectedGroups={selectedGroups}
			/>
			<div className="flex items-center gap-2">
				<PersonFilter
					actors={filtersData.actors}
					onToggleActor={toggleActor}
					selectedActorIds={selectedActorIds}
				/>
				{hasActiveFilters && (
					<Button
						className="h-7 px-2 text-xs"
						onClick={clearFilters}
						size="sm"
						variant="ghost"
					>
						{t("clearFilters")}
					</Button>
				)}
			</div>
		</div>
	) : null;

	const listBlock = (
		<>
			{isLoading && (
				<div
					className="animate-in fade-in-0 duration-200"
					style={{
						animationDelay: "150ms",
						animationFillMode: "backwards",
					}}
				>
					<FeedSkeleton />
				</div>
			)}

			{isError && (
				<div className="flex flex-col items-center justify-center gap-3 py-12">
					<p className="text-muted-foreground text-sm">
						{t("couldntLoadActivityFeed")}
					</p>
					<Button onClick={() => void refetch()} size="sm" variant="outline">
						{t("tryAgain")}
					</Button>
				</div>
			)}

			{!isLoading && !isError && allEntries.length === 0 && (
				<div className="flex flex-col items-center justify-center gap-2 py-12">
					{hasActiveFilters ? (
						<>
							<p className="text-muted-foreground text-sm">
								{t("noEventsMatchFilters")}
							</p>
							<Button onClick={clearFilters} size="sm" variant="outline">
								{t("clearFilters")}
							</Button>
						</>
					) : (
						<p className="text-center text-muted-foreground text-sm">
							{t("noActivityYet")}
						</p>
					)}
				</div>
			)}

			{!isLoading && !isError && allEntries.length > 0 && (
				<>
					{entriesWithSeparators.map((item) =>
						item.type === "separator" ? (
							<DateSeparator key={item.key} label={item.label} />
						) : (
							<ActivityGroupView
								group={item.group}
								key={item.key}
								onViewFullHistory={handleViewFullHistory}
							/>
						),
					)}

					{/* Load more */}
					{hasNextPage && (
						<div className="flex justify-center py-4">
							<Button
								disabled={isFetchingNextPage}
								onClick={() => void fetchNextPage()}
								size="sm"
								variant="outline"
							>
								{isFetchingNextPage ? (
									<>
										<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
										{t("loading")}
									</>
								) : (
									t("loadMore")
								)}
							</Button>
						</div>
					)}
				</>
			)}
		</>
	);

	// Sheet layout keeps the sticky-header split used by ActivityFeedPanel.
	if (layout === "sheet") {
		return (
			<>
				<div className="border-b px-6 py-4 pr-12">
					{header}
					{filtersBlock}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
					{listBlock}
				</div>
			</>
		);
	}

	// Plain panel layout for the Activity tab. The list gets its own scroll box so
	// the feed (and its "load more") stays reachable even when the tab area clips.
	return (
		<div className="flex flex-col gap-3">
			{header}
			{filtersBlock}
			<div className="max-h-[calc(100dvh-14rem)] overflow-y-auto">
				{listBlock}
			</div>
		</div>
	);
}
