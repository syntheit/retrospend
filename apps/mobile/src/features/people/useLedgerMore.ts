import { useCallback, useState } from "react";
import { useSession } from "@/auth/session";
import type { LedgerRow } from "./PersonSections";
import type { PersonRef } from "./source";

/**
 * The shared expenses beyond the newest few the person page carries: "Show
 * all" reads the ledger from its first page, then the rest page by page.
 */
export function useLedgerMore(person: PersonRef) {
	const { api } = useSession();
	const [rows, setRows] = useState<LedgerRow[] | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const read = useCallback(
		async (after: string | undefined) => {
			if (!api || busy) return;
			setBusy(true);
			try {
				const page = await api.people.ledger({
					type: person.type,
					id: person.id,
					cursor: after,
				});
				setRows((prev) => [...(after ? (prev ?? []) : []), ...page.items]);
				setCursor(page.nextCursor);
			} catch {
				// The button stays; a second tap tries again.
			} finally {
				setBusy(false);
			}
		},
		[api, busy, person.type, person.id],
	);

	return {
		rows,
		hasMore: rows !== null && cursor !== null,
		loadAll: () => read(undefined),
		loadMore: () => read(cursor ?? undefined),
	};
}
