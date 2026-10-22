"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevisionHistory } from "~/components/revision-history-provider";
import { api } from "~/trpc/react";
import {
	filterNotifications,
	historyTransactionId,
	isNotificationFilter,
	type NotificationFilter,
	notificationHref,
	type ShellNotification,
} from "./notification-data";

const LIST_INPUT = { limit: 20 };
// The same key as today's bell, so the chosen filter carries over.
const FILTER_KEY = "notif-filter";

/** The unread count for the bell and the account sheet, polled like today's bell. */
export function useUnreadNotifications(): number {
	const { data } = api.notification.unreadCount.useQuery(undefined, {
		refetchInterval: 30_000,
		refetchIntervalInBackground: false,
	});
	return data?.count ?? 0;
}

function readFilter(): NotificationFilter {
	try {
		const stored = localStorage.getItem(FILTER_KEY);
		return isNotificationFilter(stored) ? stored : "all";
	} catch {
		return "all";
	}
}

/**
 * The notifications feed while its popover or sheet is open: the filtered
 * list, mark one read on open, mark all read. Reads today's notification
 * procedures; only the look changed.
 */
export function useNotificationFeed(open: boolean, onNavigate: () => void) {
	const router = useRouter();
	const utils = api.useUtils();
	const { openHistory } = useRevisionHistory();
	const [filter, setFilterState] = useState<NotificationFilter>("all");
	useEffect(() => setFilterState(readFilter()), []);

	const { data, isLoading, isError, refetch } =
		api.notification.list.useQuery(LIST_INPUT, { enabled: open });
	const refresh = () => {
		void utils.notification.unreadCount.invalidate();
		void utils.notification.list.invalidate();
	};
	const markRead = api.notification.markRead.useMutation({
		onSuccess: refresh,
	});
	const markAllRead = api.notification.markAllRead.useMutation({
		onSuccess: refresh,
	});

	const setFilter = useCallback((next: NotificationFilter) => {
		setFilterState(next);
		try {
			localStorage.setItem(FILTER_KEY, next);
		} catch {
			// Storage can be off (private window); the filter still applies.
		}
	}, []);

	const all = data?.items ?? [];
	const items = useMemo(() => filterNotifications(all, filter), [all, filter]);

	const openNotification = (n: ShellNotification) => {
		if (!n.isRead) markRead.mutate({ id: n.id });
		onNavigate();
		const href = notificationHref(n);
		if (href) router.push(href);
		const historyId = historyTransactionId(n);
		if (historyId) openHistory(historyId);
	};

	return {
		filter,
		setFilter,
		items,
		total: all.length,
		hasUnread: all.some((n) => !n.isRead),
		isLoading,
		isError,
		retry: () => void refetch(),
		openNotification,
		markAllRead: () => markAllRead.mutate(),
		markingAll: markAllRead.isPending,
	};
}
