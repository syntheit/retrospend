import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { deviceWrites } from "@/data/deviceWrites";
import { subscribeEntryChanges } from "./events";
import { type ParkedEntry, parkedFrom } from "./parked-entry";
import { resolveParked } from "./parked-resolve";
import type { PreviewDto } from "./preview";
import { exclusive, flushEntries } from "./queue";
import { commitRebase, planRebase } from "./rebase";
import { forgetNotFound, isEntryEntity, SEND_TIMEOUT_MS } from "./send";

// Writes the server refused wait in the outbox, parked and never dropped.
// This is how they come back into view: a list for a "Couldn't sync" row,
// with Try again and Discard.

/** What Try again would do, shown before it is sent. */
export interface RebaseOffer {
	kind: "update" | "delete";
	/** The server's dry run of the re-based write. */
	diff: PreviewDto;
	/** Saves it over the newer version and sends it; true when the server took it. */
	save: () => Promise<boolean>;
}

export function useParkedEntries() {
	const { api, local } = useSession();
	const [entries, setEntries] = useState<ParkedEntry[]>([]);
	const [version, setVersion] = useState(0);

	useEffect(() => subscribeEntryChanges(() => setVersion((v) => v + 1)), []);

	useEffect(() => {
		// `version` makes a change elsewhere reload the list.
		void version;
		if (!local) {
			setEntries([]);
			return;
		}
		let cancelled = false;
		(async () => {
			const parked: ParkedEntry[] = [];
			for (const e of await local.outbox.all()) {
				if (e.state !== "conflict" || !isEntryEntity(e.entity)) continue;
				const row = api
					? await resolveParked(local.outbox, api, e)
					: parkedFrom(e);
				if (row) parked.push(row);
			}
			if (!cancelled) setEntries(parked);
		})().catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [api, local, version]);

	const refresh = useCallback(() => setVersion((v) => v + 1), []);

	/** Sends it again; true when the server took it this time. */
	const retry = useCallback(
		async (clientId: string) => {
			if (!local || !api) return false;
			await local.outbox.requeue(clientId);
			await flushEntries(local.outbox, api);
			const still = (await local.outbox.all()).some(
				(e) => e.clientId === clientId,
			);
			refresh();
			return !still;
		},
		[api, local, refresh],
	);

	/**
	 * Try again for a write that met a newer version of its row: the dry run of
	 * the write saved over that version. Null when it cannot be previewed (the
	 * row cannot be read, or no answer): nothing is sent unseen.
	 */
	const rebase = useCallback(
		async (clientId: string): Promise<RebaseOffer | null> => {
			const writes = api ? deviceWrites(api) : null;
			if (!local || !api || !writes) return null;
			const plan = await planRebase({ outbox: local.outbox, writes, clientId });
			if (!plan) return null;
			const timeout = new AbortController();
			const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
			const options = { signal: timeout.signal };
			const expectedUpdatedAt = plan.version;
			try {
				const diff =
					plan.op.kind === "delete"
						? await api.expenses.previewDelete(
								{ id: plan.op.id, expectedUpdatedAt },
								options,
							)
						: await api.expenses.previewUpdate(
								{
									...plan.payload,
									expectedUpdatedAt,
								} as Parameters<typeof api.expenses.previewUpdate>[0],
								options,
							);
				return {
					kind: plan.op.kind === "delete" ? "delete" : "update",
					diff,
					save: async () => {
						const next = await commitRebase({
							outbox: local.outbox,
							writes,
							clientId,
							plan,
						});
						if (!next) return false;
						forgetNotFound(clientId);
						await flushEntries(local.outbox, api);
						const still = (await local.outbox.all()).some(
							(e) => e.clientId === next,
						);
						refresh();
						return !still;
					},
				};
			} catch {
				return null;
			} finally {
				clearTimeout(timer);
			}
		},
		[api, local, refresh],
	);

	const discard = useCallback(
		async (clientId: string) => {
			if (!local) return;
			// Alone on the outbox, like a flush: not while a send is in flight.
			await exclusive(local.outbox, () => local.outbox.discard(clientId));
			forgetNotFound(clientId);
			refresh();
		},
		[local, refresh],
	);

	return { entries, retry, rebase, discard };
}
