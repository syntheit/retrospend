"use client";

import { useCallback, useState } from "react";
import { RebalanceExpensesDialog } from "~/components/project/rebalance-expenses-dialog";
import { api } from "~/trpc/react";

export interface RebalanceParticipant {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	name: string;
}

/**
 * Single source of the "offer to fold a newly-added participant into existing
 * expenses" flow. Owns the target state + renders the RebalanceExpensesDialog,
 * so every add-member surface (the Share dialog, the mid-expense split picker)
 * wires it identically instead of re-implementing the dialog inline.
 *
 * The prompt only fires for organizers/editors — the underlying query and
 * mutation both `requireProjectRole(EDITOR)`, so prompting anyone else would
 * only surface a dead dialog. The dialog's own empty-state (showEmpty when no
 * eligible expenses) avoids nagging when there's nothing to rebalance.
 */
export function useRebalanceOnAdd(projectId: string | undefined) {
	const [target, setTarget] = useState<RebalanceParticipant | null>(null);

	// Gate on the caller's role. Only fetched when we have a project context.
	const { data: project } = api.project.detail.useQuery(
		{ id: projectId ?? "" },
		{ enabled: !!projectId },
	);
	const canRebalance =
		project?.myRole === "ORGANIZER" || project?.myRole === "EDITOR";

	const promptRebalance = useCallback(
		(participant: RebalanceParticipant) => {
			if (!projectId || !canRebalance) return;
			setTarget(participant);
		},
		[projectId, canRebalance],
	);

	const rebalanceElement = projectId ? (
		<RebalanceExpensesDialog
			projectId={projectId}
			participant={target}
			onOpenChange={(open) => {
				if (!open) setTarget(null);
			}}
		/>
	) : null;

	return { promptRebalance, rebalanceElement };
}
