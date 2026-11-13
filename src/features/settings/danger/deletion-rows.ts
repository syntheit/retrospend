import type { RouterOutputs } from "~/trpc/react";

type Preview = RouterOutputs["user"]["previewAccountDeletion"];
type Say = (key: string, values?: { owner: string }) => string;

/**
 * The project rows of the delete sheet. The server gives a name as null when
 * it cannot read it (the key that sealed it is unavailable) or does not know
 * the person, so the words for that are here.
 */
export function projectRows(
	data: Pick<Preview, "projectsToTransfer" | "projectsToDelete">,
	say: Say,
): { key: string; title: string; meta: string }[] {
	return [
		...data.projectsToTransfer.map((p) => ({
			key: `t-${p.id}`,
			title: p.name ?? say("projectUnnamed"),
			meta: say("projectTransfer", {
				owner: p.newOrganizerName ?? say("organizerUnnamed"),
			}),
		})),
		...data.projectsToDelete.map((p) => ({
			key: `d-${p.id}`,
			title: p.name ?? say("projectUnnamed"),
			meta: say("projectDelete"),
		})),
	];
}
