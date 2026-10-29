import type { RetrospendClient } from "@retrospend/api-client";
import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { ENTITY_CACHE_LIMIT } from "@/features/read/loadCached";
import { useCachedRead } from "@/features/read/useCachedRead";
import type { ActivityItem } from "./source";

export type ExpenseDetail = Awaited<
	ReturnType<RetrospendClient["expenses"]["get"]>
>;
export type SharedDetail = Awaited<
	ReturnType<RetrospendClient["shared-expenses"]["get"]>
>;

/**
 * What the list row does not carry. A personal expense reads its notes,
 * place, spread and template from GET /expenses/{id}; a split reads who paid
 * and each share from GET /shared-expenses/{id}. A payment has neither.
 * `staleSince` is set when what shows is the phone's copy.
 */
export function useEntryDetail(item: ActivityItem): {
	personal: ExpenseDetail | null;
	shared: SharedDetail | null;
	staleSince: string | null;
	reload: () => void;
} {
	const { api } = useSession();
	const isPersonal = item.source === "personal";
	const isShared = item.source === "shared";
	const personalFetch = useMemo(
		() =>
			api && isPersonal ? () => api.expenses.get({ id: item.entityId }) : null,
		[api, isPersonal, item.entityId],
	);
	const sharedFetch = useMemo(
		() =>
			api && isShared
				? () => api["shared-expenses"].get({ id: item.entityId })
				: null,
		[api, isShared, item.entityId],
	);
	const personal = useCachedRead(
		isPersonal ? { name: `expense.${item.entityId}`, schema: 1 } : null,
		personalFetch,
		{ prefix: "expense.", keep: ENTITY_CACHE_LIMIT },
	);
	const shared = useCachedRead(
		isShared ? { name: `shared-expense.${item.entityId}`, schema: 1 } : null,
		sharedFetch,
		{ prefix: "shared-expense.", keep: ENTITY_CACHE_LIMIT },
	);
	const own = personal.state.status === "ready" ? personal.state : null;
	const split = shared.state.status === "ready" ? shared.state : null;
	return {
		personal: own?.data ?? null,
		shared: split?.data ?? null,
		staleSince: own?.staleSince ?? split?.staleSince ?? null,
		reload: () => {
			void personal.reload();
			void shared.reload();
		},
	};
}
