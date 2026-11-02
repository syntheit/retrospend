import { useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { useMoneyLocale } from "@/lib/money";
import { type RestoredDraft, restoreDraft } from "./pendingDraft";

export type RestoreState =
	| { status: "idle" }
	| { status: "loading" }
	/** Gone from the outbox (it synced meanwhile), or not rebuildable. */
	| { status: "gone" }
	| { status: "ready"; restored: RestoredDraft };

/**
 * The write a waiting entry holds, as the composer's draft, read from the
 * outbox. Idle when no waiting entry is being edited.
 */
export function usePendingRestore(clientId: string | undefined): RestoreState {
	const { local, state } = useSession();
	const locale = useMoneyLocale();
	const meId = state.status === "signedIn" ? (state.me?.id ?? "") : "";
	const [restore, setRestore] = useState<RestoreState>(
		clientId ? { status: "loading" } : { status: "idle" },
	);
	useEffect(() => {
		if (!clientId) return;
		if (!local) {
			setRestore({ status: "gone" });
			return;
		}
		let cancelled = false;
		setRestore({ status: "loading" });
		local.outbox.all().then((all) => {
			if (cancelled) return;
			const entry = all.find((e) => e.clientId === clientId);
			const restored = entry ? restoreDraft(entry, { locale, meId }) : null;
			setRestore(restored ? { status: "ready", restored } : { status: "gone" });
		});
		return () => {
			cancelled = true;
		};
	}, [clientId, local, locale, meId]);
	return restore;
}
