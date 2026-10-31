import type { RetrospendClient } from "@retrospend/api-client";
import { canEditProject } from "./projectForm";

// Sharing a project: an invite link per role (the one link a person opens to
// join), and the public page (a read-only page for anyone with the address).
// The guest join flow and the public page are web pages: they are for people
// who do not have the app, so the phone sends the address and never rebuilds
// them.

export type MagicLink = Awaited<
	ReturnType<RetrospendClient["projects"]["magicLinks"]>
>["items"][number];

/** The roles a link grants. Never Owner. */
export const LINK_ROLES = ["CONTRIBUTOR", "VIEWER"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/** The active link of a role, if there is one. */
export function activeLink(
	links: readonly MagicLink[],
	role: LinkRole,
): MagicLink | null {
	return links.find((l) => l.isActive && l.roleGranted === role) ?? null;
}

/** Owners and Editors make, replace and turn off invite links. */
export function canManageLinks(role: string | null): boolean {
	return canEditProject(role);
}

/** Making the page public or private is the Owner's. */
export function canSetPublic(role: string | null): boolean {
	return role === "ORGANIZER";
}

/** The address of the project's page on the connected server, with the invite when there is one. */
export function projectPageUrl(
	baseUrl: string,
	projectId: string,
	invite?: string | null,
): string {
	const base = baseUrl.replace(/\/+$/, "");
	const query = invite ? `?invite=${encodeURIComponent(invite)}` : "";
	return `${base}/projects/${encodeURIComponent(projectId)}${query}`;
}

/** One line of "who can see what". */
export type Access =
	| { id: "members" }
	| { id: "link"; role: LinkRole }
	| { id: "public"; on: boolean };

/**
 * Who can see the project, in the order they get wider: its members, anyone
 * holding an active link (per role), and anyone with the public address.
 */
export function accessOf(options: {
	links: readonly MagicLink[];
	isPublic: boolean;
}): Access[] {
	return [
		{ id: "members" },
		...LINK_ROLES.filter((role) => activeLink(options.links, role)).map(
			(role) => ({ id: "link" as const, role }),
		),
		{ id: "public", on: options.isPublic },
	];
}
