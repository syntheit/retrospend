import { useEffect } from "react";
import { useSession } from "@/auth/session";
import type { EntryMode } from "@/features/entry/ComposerShell";
import { GALLERY_ENABLED } from "@/lib/flags";

// A screenshot tour for the composer. simctl cannot tap, so a build made with
// EXPO_PUBLIC_DEV_COMPOSE="expense,transfer,edit" opens the composer on each
// of those, one every STEP_MS after sign in. "edit" opens the newest plain
// expense the account has. Release builds never set it.
const STEPS = process.env.EXPO_PUBLIC_DEV_COMPOSE;
const STEP_MS = 12_000;

interface Opener {
	open(mode: EntryMode): void;
	edit(id: string): void;
}

export function DevComposerTour({ add }: { add: Opener }) {
	const { api, state } = useSession();
	const signedIn = state.status === "signedIn";
	useEffect(() => {
		if (!GALLERY_ENABLED || !STEPS || !signedIn || !api) return;
		const timers = STEPS.split(",").map((step, index) =>
			setTimeout(
				async () => {
					if (step !== "edit") return add.open(step as EntryMode);
					const page = await api.expenses.list({ limit: 30 });
					const row = page.items.find(
						(item) =>
							item.source === "personal" &&
							item.kind === "expense" &&
							item.canEdit &&
							!item.locked,
					);
					if (row) add.edit(row.entityId);
				},
				(index + 1) * STEP_MS,
			),
		);
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
		// The opener changes with every render; the tour starts once.
		// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	}, [signedIn, api]);
	return null;
}

// The release bundle check (scripts/check-release-bundle.sh) greps for this
// name: it must not appear in a release bundle.
DevComposerTour.displayName = "RetrospendDevComposerTour";
