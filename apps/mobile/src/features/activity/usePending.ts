import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import type { OutboxEntry } from "@/data/outbox";
import { ENTRY_CATALOG_CACHE } from "@/features/entry/catalog";
import { subscribeEntryChanges } from "@/features/entry/events";
import { isEntryEntity } from "@/features/entry/send";
import { recentlySent } from "@/features/entry/sentRetain";
import type { EntryCatalog } from "@/features/entry/types";
import { type PendingContext, pendingRows } from "./pending";
import type { ActivityItem } from "./source";
import { useCategories } from "./useCategories";

/** How long a sent entry is held when the list's read never settles. */
const HOLD_MS = 20_000;

interface Held {
	entry: OutboxEntry;
	/** What the list had settled on when the entry was taken in. */
	under: unknown;
	at: number;
}

/**
 * The entries waiting on this phone, as rows, for a list to merge in. One
 * place for every list (Activity, Home's Recent): it follows the outbox, and
 * keeps an entry that was just sent on screen, no longer marked, until the
 * list's own read has the server's row (`settled` changes then), so a sync
 * swaps the row without a gap or a double.
 *
 * `settled` is the list's last complete server answer (null while it has none).
 */
export function usePendingRows(settled: unknown): ActivityItem[] {
	return usePendingFeed(settled).rows;
}

/** `usePendingRows`, and whether the outbox has been read yet. */
export function usePendingFeed(settled: unknown): {
	rows: ActivityItem[];
	loaded: boolean;
} {
	const { local } = useSession();
	const [loaded, setLoaded] = useState(false);
	const t = useTranslations("mobile.activity");
	const categories = useCategories();
	const [live, setLive] = useState<OutboxEntry[]>([]);
	const [version, setVersion] = useState(0);
	const [places, setPlaces] = useState<ReadonlyMap<string, string>>(new Map());
	const held = useRef(new Map<string, Held>());
	const [heldList, setHeldList] = useState<OutboxEntry[]>([]);
	const settledRef = useRef(settled);
	settledRef.current = settled;

	useEffect(() => subscribeEntryChanges(() => setVersion((v) => v + 1)), []);

	// The accounts' names come from the composer's cached catalog.
	useEffect(() => {
		if (!local) return;
		let cancelled = false;
		local.cache
			.read<EntryCatalog>(ENTRY_CATALOG_CACHE.name, ENTRY_CATALOG_CACHE.schema)
			.then((cached) => {
				if (cancelled || !cached) return;
				setPlaces(new Map(cached.data.places.map((p) => [p.id, p.name])));
			});
		return () => {
			cancelled = true;
		};
	}, [local]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the trigger
	useEffect(() => {
		if (!local) {
			setLive([]);
			return;
		}
		let cancelled = false;
		local.outbox.all().then((all) => {
			if (cancelled) return;
			const mine = all.filter(
				(e) => isEntryEntity(e.entity) && e.kind === "create",
			);
			const ids = new Set(mine.map((e) => e.clientId));
			const now = Date.now();
			for (const [id, h] of held.current) {
				if (ids.has(id) || now - h.at > HOLD_MS) held.current.delete(id);
			}
			for (const entry of recentlySent(now)) {
				if (!ids.has(entry.clientId) && !held.current.has(entry.clientId)) {
					held.current.set(entry.clientId, {
						entry,
						under: settledRef.current,
						at: now,
					});
				}
			}
			setLive(mine);
			setLoaded(true);
			setHeldList([...held.current.values()].map((h) => h.entry));
		});
		return () => {
			cancelled = true;
		};
	}, [local, version]);

	// The list read again after the entry was sent: its answer is the truth now.
	useEffect(() => {
		let changed = false;
		for (const [id, h] of held.current) {
			if (h.under !== settled) {
				held.current.delete(id);
				changed = true;
			}
		}
		if (changed) {
			setHeldList([...held.current.values()].map((h) => h.entry));
		}
	}, [settled]);

	const map = useMemo(
		() =>
			new Map(
				(categories.state.status === "ready" ? categories.state.data : []).map(
					(c) => [c.id, c],
				),
			),
		[categories.state],
	);

	const rows = useMemo(() => {
		const ctx: PendingContext = {
			categories: map,
			places,
			transferWord: t("row.transfer"),
		};
		// Newest write first, so a day's waiting rows read newest first.
		const waiting = pendingRows([...live].reverse(), ctx);
		const sent = pendingRows([...heldList].reverse(), ctx).map((row) => ({
			...row,
			unsynced: false,
		}));
		return [...waiting, ...sent];
	}, [live, heldList, map, places, t]);
	return { rows, loaded };
}
