"use client";

import type { FixRequestDto } from "~/lib/schemas/corrections";
import { api } from "~/trpc/react";

const isOpen = (r: FixRequestDto) =>
	r.status === "PENDING" || r.status === "ACCEPTED";

/**
 * What the corrections router says about one split for the viewer: its lock
 * and who may correct or ask (`lockStates`, the one place that decides),
 * the request the viewer was asked to answer, and the latest one the viewer
 * sent. Requests are visible to the asker and the asked only.
 */
export function useFixState(id: string, me: string | undefined) {
	const lock = api.corrections.lockStates.useQuery({ transactionIds: [id] });
	const requests = api.corrections.fixRequests.useQuery({ transactionId: id });
	const all = requests.data ?? [];
	const mine = (p: { type: string; id: string }) =>
		!!me && p.type === "user" && p.id === me;
	return {
		lock: lock.data?.find((l) => l.transactionId === id) ?? null,
		/** Open request that asks the viewer to fix this split. */
		asked: all.find((r) => isOpen(r) && mine(r.asked)) ?? null,
		/** The viewer's latest request, open or answered. */
		sent: all.filter((r) => mine(r.requestedBy)).at(-1) ?? null,
		loading: lock.isLoading || requests.isLoading,
	};
}

export type FixState = ReturnType<typeof useFixState>;
export { isOpen as isOpenRequest };
