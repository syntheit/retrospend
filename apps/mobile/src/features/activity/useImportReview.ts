import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { subscribeEntryChanges } from "@/features/entry/events";

/**
 * How many imported expenses wait for a check: the server's Needs you item
 * `import.review`. Null while unknown, offline or when nothing waits, so the
 * notice only ever shows a number the server sent.
 */
export function useImportReview(): number | null {
	const { api } = useSession();
	const [count, setCount] = useState<number | null>(null);
	const alive = useRef(true);

	const read = useCallback(async () => {
		if (!api) return;
		try {
			const list = await api["needs-you"].list();
			const item = list.items.find((i) => i.type === "import.review");
			const n = item?.count ?? item?.entityIds.length ?? 0;
			if (alive.current) setCount(n > 0 ? n : null);
		} catch {
			// Offline: the notice simply is not drawn.
		}
	}, [api]);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	useEffect(() => subscribeEntryChanges(() => void read()), [read]);
	useFocusEffect(
		useCallback(() => {
			void read();
		}, [read]),
	);
	return count;
}
