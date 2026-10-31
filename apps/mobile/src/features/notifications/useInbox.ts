import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useToast } from "@/ui/Toast";
import { unreadCount, withNextPage, withRead } from "./rules";
import { fetchInbox, INBOX_CACHE, type InboxData, PAGE } from "./source";

/**
 * The inbox: the phone's copy first, then the server's, and again each time
 * the screen is back in focus. Marking read changes the rows at once and
 * saves to the server; when the save fails the rows go back to what the
 * server says and a toast tells so. What the phone keeps follows the
 * change, so the offline copy never shows a read note as new.
 */
export function useInbox() {
	const t = useTranslations("mobile.notifications");
	const toast = useToast();
	const { api, local } = useSession();
	const fetch = useMemo(() => (api ? fetchInbox(api) : null), [api]);
	const { state, reload } = useCachedRead(INBOX_CACHE, fetch);
	const [data, setData] = useState<InboxData | null>(null);
	const latest = useRef<InboxData | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [more, setMore] = useState(false);

	useEffect(() => {
		if (state.status !== "ready") return;
		latest.current = state.data;
		setData(state.data);
	}, [state]);

	const keep = useCallback(
		(next: InboxData) => {
			latest.current = next;
			setData(next);
			void local?.cache
				.write(INBOX_CACHE.name, INBOX_CACHE.schema, next)
				.catch(() => undefined);
		},
		[local],
	);

	const markRead = useCallback(
		async (ids: string[]) => {
			const now = latest.current;
			if (!api || !now || ids.length === 0) return;
			keep(withRead(now, ids));
			try {
				await Promise.all(ids.map((id) => api.notifications.markRead({ id })));
			} catch {
				toast.show({ message: t("markError") });
				void reload();
			}
		},
		[api, keep, reload, t, toast],
	);

	const markAllRead = useCallback(async () => {
		const now = latest.current;
		if (!api || !now) return;
		keep(withRead(now, null));
		try {
			await api.notifications.markAllRead();
		} catch {
			toast.show({ message: t("markError") });
			void reload();
		}
	}, [api, keep, reload, t, toast]);

	const showMore = useCallback(async () => {
		const now = latest.current;
		if (!api || !now?.nextCursor || more) return;
		setMore(true);
		try {
			const page = await api.notifications.list({
				limit: PAGE,
				cursor: now.nextCursor,
			});
			// The list may have changed (a mark read) while the page loaded.
			keep(withNextPage(latest.current ?? now, page));
		} catch {
			toast.show({ message: t("moreError") });
		} finally {
			setMore(false);
		}
	}, [api, keep, more, t, toast]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await reload();
		} finally {
			setRefreshing(false);
		}
	}, [reload]);

	return {
		state,
		data,
		unread: data ? unreadCount(data.items) : 0,
		refreshing,
		refresh,
		reload,
		markRead,
		markAllRead,
		showMore,
		loadingMore: more,
	};
}
