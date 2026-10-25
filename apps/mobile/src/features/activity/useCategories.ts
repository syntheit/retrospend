import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { useCachedRead } from "@/features/read/useCachedRead";

const CATEGORIES_CACHE = { name: "categories", schema: 1 } as const;

/** The caller's categories (for the filter chip), cache first. */
export function useCategories() {
	const { api } = useSession();
	const fetch = useMemo(
		() =>
			api
				? async () => (await api.categories.list({ limit: 200 })).items
				: null,
		[api],
	);
	return useCachedRead(CATEGORIES_CACHE, fetch);
}
