"use client";

import {
	Bell,
	BellOff,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	CircleDollarSign,
	ClipboardCheck,
	HandCoins,
	PencilLine,
	Trash2,
	UserPlus,
	X,
	XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevisionHistory } from "~/components/revision-history-provider";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Skeleton } from "~/components/ui/skeleton";
import { formatRelativeTimeCompact } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

type Notification = RouterOutputs["notification"]["list"]["items"][number];
type NotificationType = Notification["type"];

const TYPE_CONFIG: Record<
	NotificationType,
	{ icon: React.ComponentType<{ className?: string }>; color: string }
> = {
	EXPENSE_SPLIT: { icon: CircleDollarSign, color: "text-blue-500" },
	VERIFICATION_REQUEST: { icon: ClipboardCheck, color: "text-orange-500" },
	EXPENSE_EDITED: { icon: PencilLine, color: "text-yellow-600" },
	EXPENSE_DELETED: { icon: Trash2, color: "text-red-500" },
	SETTLEMENT_RECEIVED: { icon: HandCoins, color: "text-emerald-500" },
	SETTLEMENT_CONFIRMED: { icon: CheckCheck, color: "text-emerald-600" },
	SETTLEMENT_REJECTED: { icon: XCircle, color: "text-red-500" },
	PERIOD_CLOSED: { icon: ClipboardCheck, color: "text-purple-500" },
	PARTICIPANT_ADDED: { icon: UserPlus, color: "text-indigo-500" },
	PAYMENT_REMINDER: { icon: CircleDollarSign, color: "text-red-600" },
};

function getNavigationUrl(notification: Notification): string | null {
	const data = notification.data as Record<string, string> | null;
	if (!data) return null;

	switch (notification.type) {
		case "EXPENSE_SPLIT":
		case "EXPENSE_EDITED":
		case "EXPENSE_DELETED":
			if (data.actorType && data.actorId) {
				return `/people/${data.actorType}/${data.actorId}`;
			}
			return "/people";
		case "VERIFICATION_REQUEST":
			return "/people";
		case "SETTLEMENT_RECEIVED":
			if (data.fromParticipantType && data.fromParticipantId) {
				return `/people/${data.fromParticipantType}/${data.fromParticipantId}`;
			}
			return "/people";
		case "SETTLEMENT_CONFIRMED":
		case "SETTLEMENT_REJECTED":
			if (data.toParticipantType && data.toParticipantId) {
				return `/people/${data.toParticipantType}/${data.toParticipantId}`;
			}
			return "/people";
		case "PAYMENT_REMINDER":
			if (data.fromParticipantType && data.fromParticipantId) {
				return `/people/${data.fromParticipantType}/${data.fromParticipantId}`;
			}
			return "/people";
		case "PERIOD_CLOSED":
		case "PARTICIPANT_ADDED":
			if (data.projectId) {
				return `/projects/${data.projectId}`;
			}
			return "/projects";
		default:
			return null;
	}
}

/* ------------------------------------------------------------------ */
/*  9.2 — Filter categories                                          */
/* ------------------------------------------------------------------ */

type FilterCategory = "all" | "expenses" | "settlements" | "projects";

const FILTER_CONFIG: Record<
	FilterCategory,
	{ label: string; types: NotificationType[] | null }
> = {
	all: { label: "All", types: null },
	expenses: {
		label: "Expenses",
		types: ["EXPENSE_SPLIT", "EXPENSE_EDITED", "EXPENSE_DELETED"],
	},
	settlements: {
		label: "Settlements",
		types: [
			"SETTLEMENT_RECEIVED",
			"SETTLEMENT_CONFIRMED",
			"SETTLEMENT_REJECTED",
			"PAYMENT_REMINDER",
		],
	},
	projects: {
		label: "Projects",
		types: ["PERIOD_CLOSED", "PARTICIPANT_ADDED", "VERIFICATION_REQUEST"],
	},
};

const FILTER_KEYS: FilterCategory[] = [
	"all",
	"expenses",
	"settlements",
	"projects",
];

/* ------------------------------------------------------------------ */
/*  9.1 — Notification grouping                                      */
/* ------------------------------------------------------------------ */

function getGroupingKey(n: Notification): string {
	const data = n.data as Record<string, string> | null;
	const actorId =
		data?.actorId ??
		data?.fromParticipantId ??
		data?.toParticipantId ??
		data?.projectId ??
		"";
	return `${n.type}:${actorId}`;
}

interface NotificationGroup {
	key: string;
	type: NotificationType;
	items: Notification[];
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function groupNotifications(
	notifications: Notification[],
): NotificationGroup[] {
	if (notifications.length === 0) return [];

	const groups: NotificationGroup[] = [];

	for (const n of notifications) {
		const gKey = getGroupingKey(n);
		const last = groups[groups.length - 1];

		if (last && last.key.startsWith(gKey + ":")) {
			const firstInGroup = last.items[0]!;
			const diff = Math.abs(
				new Date(firstInGroup.createdAt).getTime() -
					new Date(n.createdAt).getTime(),
			);
			if (diff <= ONE_HOUR_MS) {
				last.items.push(n);
				continue;
			}
		}

		groups.push({
			key: `${gKey}:${n.id}`,
			type: n.type,
			items: [n],
		});
	}

	return groups;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

function NotificationItem({
	notification,
	onClick,
}: {
	notification: Notification;
	onClick: () => void;
}) {
	const config = TYPE_CONFIG[notification.type];
	const Icon = config?.icon ?? Bell;

	return (
		<button
			className={cn(
				"flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
				!notification.isRead && "bg-blue-50/60 dark:bg-blue-950/20",
			)}
			onClick={onClick}
			type="button"
		>
			<div
				className={cn(
					"mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted",
					config?.color,
				)}
			>
				<Icon className="h-4 w-4" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-start justify-between gap-2">
					<p
						className={cn(
							"text-sm leading-tight",
							!notification.isRead
								? "font-semibold"
								: "font-medium",
						)}
					>
						{notification.title}
					</p>
					<span className="flex-shrink-0 text-muted-foreground text-xs">
						{formatRelativeTimeCompact(notification.createdAt)}
					</span>
				</div>
				<p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
					{notification.body}
				</p>
				{notification.type === "EXPENSE_EDITED" &&
				(notification.data as Record<string, unknown> | null)
					?.changes ? (
					<p className="mt-1 line-clamp-2 rounded-sm bg-muted/60 px-1.5 py-1 text-[11px] text-muted-foreground">
						{String(
							(notification.data as Record<string, unknown>)
								.changes,
						)}
					</p>
				) : null}
			</div>
			{!notification.isRead && (
				<div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
			)}
		</button>
	);
}

export function NotificationBell() {
	const [open, setOpen] = useState(false);
	const router = useRouter();
	const { openHistory } = useRevisionHistory();
	const utils = api.useUtils();

	const { data: countData } = api.notification.unreadCount.useQuery(
		undefined,
		{
			refetchInterval: 30_000,
			refetchIntervalInBackground: false,
		},
	);

	const { data, isLoading } = api.notification.list.useQuery(
		{ limit: 20 },
		{ enabled: open },
	);

	const markRead = api.notification.markRead.useMutation({
		onSuccess: () => {
			void utils.notification.unreadCount.invalidate();
			void utils.notification.list.invalidate();
		},
	});

	const markAllRead = api.notification.markAllRead.useMutation({
		onSuccess: () => {
			void utils.notification.unreadCount.invalidate();
			void utils.notification.list.invalidate();
		},
	});

	const unreadCount = countData?.count ?? 0;
	const notifications = data?.items ?? [];

	/* Filter state (9.2) — persisted in localStorage */
	const [filter, setFilter] = useState<FilterCategory>("all");
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
		new Set(),
	);

	useEffect(() => {
		const stored = localStorage.getItem(
			"notif-filter",
		) as FilterCategory | null;
		if (stored && stored in FILTER_CONFIG) setFilter(stored);
	}, []);

	const handleFilterChange = useCallback((f: FilterCategory) => {
		setFilter(f);
		localStorage.setItem("notif-filter", f);
	}, []);

	const toggleGroup = useCallback((groupKey: string) => {
		setExpandedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(groupKey)) next.delete(groupKey);
			else next.add(groupKey);
			return next;
		});
	}, []);

	/* Filtered + grouped notifications */
	const groups = useMemo(() => {
		let filtered = notifications;
		const filterTypes = FILTER_CONFIG[filter].types;
		if (filterTypes) {
			const typeSet = new Set(filterTypes);
			filtered = notifications.filter((n) => typeSet.has(n.type));
		}
		return groupNotifications(filtered);
	}, [notifications, filter]);

	const handleOpen = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			setExpandedGroups(new Set());
		}
		if (isOpen && unreadCount > 0) {
			// Optimistically clear the badge and mark list items as read
			utils.notification.unreadCount.setData(undefined, { count: 0 });
			utils.notification.list.setData({ limit: 20 }, (old) =>
				old
					? {
							...old,
							items: old.items.map((n) => ({
								...n,
								isRead: true,
							})),
						}
					: old,
			);
			markAllRead.mutate();
		}
	};

	const handleNotificationClick = (notification: Notification) => {
		if (!notification.isRead) {
			markRead.mutate({ id: notification.id });
		}
		const url = getNavigationUrl(notification);
		if (url) {
			router.push(url);
		}
		setOpen(false);
		// For expense edit/delete notifications, open the revision history drawer
		// so the user can see exactly what changed without hunting for the transaction.
		const data = notification.data as Record<string, string> | null;
		if (
			(notification.type === "EXPENSE_EDITED" ||
				notification.type === "EXPENSE_DELETED") &&
			data?.transactionId
		) {
			openHistory(data.transactionId);
		}
	};

	return (
		<Popover onOpenChange={handleOpen} open={open}>
			<PopoverTrigger asChild>
				<Button
					aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
					className="relative h-8 w-8 after:absolute after:-inset-1.5 after:content-[''] md:after:hidden"
					size="icon"
					variant="ghost"
				>
					<Bell className="h-4 w-4" />
					{unreadCount > 0 && (
						<span aria-hidden="true" className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 font-semibold tabular-nums text-[10px] text-white leading-none">
							{unreadCount > 99 ? "99+" : unreadCount}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0" sideOffset={8}>
				{/* Header */}
				<div className="flex items-center justify-between border-b px-4 py-3">
					<h3 className="font-semibold text-sm">Notifications</h3>
					<div className="flex items-center gap-1">
						<Button
							aria-label="Close notifications"
							className="relative h-6 w-6 after:absolute after:-inset-2.5 after:content-['']"
							onClick={() => setOpen(false)}
							size="icon"
							variant="ghost"
						>
							<X className="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>

				{/* Filter chips (9.2) */}
				<div className="flex gap-1 border-b px-4 py-2">
					{FILTER_KEYS.map((f) => (
						<button
							className={cn(
								"rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
								filter === f
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:bg-muted/80",
							)}
							key={f}
							onClick={() => handleFilterChange(f)}
							type="button"
						>
							{FILTER_CONFIG[f].label}
						</button>
					))}
				</div>

				{/* Notification list */}
				<div className="max-h-[420px] overflow-y-auto">
					{isLoading ? (
						<div className="flex flex-col gap-2 p-4">
							{[1, 2, 3].map((i) => (
								<div className="flex gap-3 p-2" key={i}>
									<Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
									<div className="flex-1 space-y-2">
										<Skeleton className="h-3 w-2/3" />
										<Skeleton className="h-3 w-full" />
									</div>
								</div>
							))}
						</div>
					) : notifications.length === 0 ? (
						<EmptyState
							className="py-8"
							description="No notifications yet"
							icon={BellOff}
							title="You're All Caught Up"
						/>
					) : groups.length === 0 ? (
						<EmptyState
							className="py-8"
							description="No notifications match this filter"
							icon={BellOff}
							title="No Results"
						/>
					) : (
						<div className="divide-y">
							{groups.map((group) => {
								const isExpanded = expandedGroups.has(
									group.key,
								);

								if (group.items.length === 1) {
									return (
										<NotificationItem
											key={group.key}
											notification={group.items[0]!}
											onClick={() =>
												handleNotificationClick(
													group.items[0]!,
												)
											}
										/>
									);
								}

								return (
									<div key={group.key}>
										{isExpanded ? (
											group.items.map((n) => (
												<NotificationItem
													key={n.id}
													notification={n}
													onClick={() =>
														handleNotificationClick(
															n,
														)
													}
												/>
											))
										) : (
											<NotificationItem
												notification={group.items[0]!}
												onClick={() =>
													handleNotificationClick(
														group.items[0]!,
													)
												}
											/>
										)}
										<button
											className="flex w-full items-center gap-1 border-t border-dashed px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
											onClick={() =>
												toggleGroup(group.key)
											}
											type="button"
										>
											{isExpanded ? (
												<>
													<ChevronDown className="h-3 w-3" />
													Show less
												</>
											) : (
												<>
													<ChevronRight className="h-3 w-3" />
													and{" "}
													{group.items.length - 1}{" "}
													more
												</>
											)}
										</button>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
