import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { subscribeEntryChanges } from "./events";
import { exclusive, flushEntries } from "./queue";
import { type ParkedEntry, parkedFrom } from "./parked-entry";
import { isEntryEntity } from "./send";

// Writes the server refused wait in the outbox, parked and never dropped.
// This is how they come back into view: a list for a "Couldn't sync" row,
// with Try again and Discard.

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
		local.outbox.all().then((all) => {
			if (cancelled) return;
			setEntries(
				all
					.filter((e) => e.state === "conflict" && isEntryEntity(e.entity))
					.map(parkedFrom),
			);
		});
		return () => {
			cancelled = true;
		};
	}, [local, version]);

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

	const discard = useCallback(
		async (clientId: string) => {
			if (!local) return;
			// Alone on the outbox, like a flush: not while a send is in flight.
			await exclusive(local.outbox, () => local.outbox.discard(clientId));
			refresh();
		},
		[local, refresh],
	);

	return { entries, retry, discard };
}
