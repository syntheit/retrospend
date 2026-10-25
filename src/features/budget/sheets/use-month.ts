"use client";

import { useMemo } from "react";
import { api, type RouterOutputs } from "~/trpc/react";

export type MonthData = NonNullable<RouterOutputs["envelope"]["getMonth"]>;
export type EnvelopeRow = MonthData["groups"][number]["envelopes"][number];

/** One envelope with the name of its group, in the page's order. */
export type EnvelopeInGroup = EnvelopeRow & { groupName: string | null };

/**
 * The month a sheet works on: the same read the page makes, so a sheet and
 * the page agree and one invalidation refreshes both. Sheets only read it;
 * every figure is the server's.
 */
export function useMonth(month: number | undefined) {
	const query = api.envelope.getMonth.useQuery(month ? { month } : {}, {
		staleTime: 5_000,
	});
	const data = query.data ?? null;
	const envelopes = useMemo<EnvelopeInGroup[]>(
		() =>
			data
				? data.groups.flatMap((g) =>
						g.envelopes.map((e) => ({ ...e, groupName: g.name })),
					)
				: [],
		[data],
	);
	const byId = useMemo(
		() => new Map(envelopes.map((e) => [e.id, e])),
		[envelopes],
	);
	return {
		data,
		envelopes,
		byId,
		loading: query.isLoading,
		failed: query.isError,
		/** The month key the sheet writes in (the viewed one). */
		monthKey: data?.month.key ?? month ?? null,
	};
}
