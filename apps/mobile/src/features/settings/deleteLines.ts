import type { RetrospendClient } from "@retrospend/api-client";

type Preview = Awaited<
	ReturnType<RetrospendClient["account"]["deletionPreview"]>
>;
type Say = (
	key: "transfer" | "deleteProject" | "projectUnnamed" | "organizerUnnamed",
	values?: { project: string; name?: string },
) => string;

/**
 * The project lines of the delete sheet. The server gives a name as null when
 * it cannot read it (the key that sealed it is unavailable) or does not know
 * the person, so the words for that are here.
 */
export function projectLines(
	what: Pick<Preview, "projectsToTransfer" | "projectsToDelete">,
	t: Say,
): string[] {
	const project = (name: string | null) => name ?? t("projectUnnamed");
	return [
		...what.projectsToTransfer.map((p) =>
			t("transfer", {
				project: project(p.name),
				name: p.newOrganizerName ?? t("organizerUnnamed"),
			}),
		),
		...what.projectsToDelete.map((p) =>
			t("deleteProject", { project: project(p.name) }),
		),
	];
}
