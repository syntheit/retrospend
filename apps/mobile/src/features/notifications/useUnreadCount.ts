import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useSession } from "@/auth/session";

/**
 * How many notifications are unread, for the bell's badge. Read each time the
 * screen it sits on comes into view; a failed read leaves no badge.
 */
export function useUnreadNotifications(): number {
	const { api } = useSession();
	const [count, setCount] = useState(0);
	useFocusEffect(
		useCallback(() => {
			if (!api) return;
			let alive = true;
			void api.notifications.unreadCount().then(
				(r) => {
					if (alive) setCount(r.count);
				},
				() => undefined,
			);
			return () => {
				alive = false;
			};
		}, [api]),
	);
	return count;
}
