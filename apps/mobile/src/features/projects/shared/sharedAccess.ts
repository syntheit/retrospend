import type { InviteInfo } from "./guestApi";

// How a person with no seat in a project reaches it: a guest with a session
// on this phone, a viewer with a link, a joiner holding an invite, or anyone
// when the project is public. The same order of questions as the web page's.

/** What this phone keeps for one project it was let into without an account. */
export interface GuestRecord {
	baseUrl: string;
	projectId: string;
	projectName: string | null;
	/** The guest's session token; null for a viewer link. */
	token: string | null;
	sessionId: string | null;
	/** The viewer link's id; null for a guest. */
	viewerLink: string | null;
	/** The name the guest joined with. */
	name: string | null;
}

export type SharedMode = "guest" | "viewer" | "public";

/** A project link as it was typed, pasted or opened. */
export interface ProjectLink {
	id: string;
	invite: string | null;
	resume: string | null;
	/** The server the address names, when it is a web address. */
	server: string | null;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The project, invite and server in a pasted address: the web address of a
 * project (`https://host/projects/ID?invite=LINK`) or the app's own
 * (`retrospend://projects/ID?invite=LINK`). Null for anything else.
 */
export function parseProjectLink(text: string): ProjectLink | null {
	const trimmed = text.trim();
	const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(
		trimmed,
	);
	if (!match) return null;
	const [, scheme, host, rawPath, rawQuery] = match;
	const web = scheme?.toLowerCase() === "https" || scheme?.toLowerCase() === "http";
	// retrospend://projects/ID puts "projects" where a host goes.
	const segments = [web ? null : host, ...(rawPath ?? "").split("/")].filter(
		(part): part is string => Boolean(part),
	);
	if (segments[0] !== "projects" || segments.length !== 2) return null;
	const id = segments[1] ?? "";
	if (!ID.test(id)) return null;
	const query = new URLSearchParams(rawQuery ?? "");
	const server = web
		? `${scheme?.toLowerCase()}://${host}`
		: serverParam(query.get("server"));
	return {
		id,
		invite: query.get("invite"),
		resume: query.get("guestResume"),
		server,
	};
}

/** A `server` query value that is a plain http(s) origin, or null. */
export function serverParam(value: string | null): string | null {
	if (!value) return null;
	const match = /^(https?):\/\/([^/?#\s]+)\/?$/i.exec(value.trim());
	return match ? `${match[1]?.toLowerCase()}://${match[2]}` : null;
}

export type Step =
	| { kind: "open"; mode: SharedMode }
	| { kind: "viewer"; link: string }
	| { kind: "join"; linkId: string; info: InviteInfo }
	| { kind: "inviteError"; reason: "invalid" | "otherProject" };

/**
 * What to do with a project address, given what the invite said (`undefined`
 * while it is being read, `null` when it is not valid) and what this phone
 * already holds for the project. Null while the invite is still being read.
 */
export function stepFor(input: {
	projectId: string;
	invite: string | null;
	info: InviteInfo | null | undefined;
	record: GuestRecord | null;
}): Step | null {
	const { projectId, invite, info, record } = input;
	if (!invite) {
		if (record?.token) return { kind: "open", mode: "guest" };
		if (record?.viewerLink) return { kind: "open", mode: "viewer" };
		return { kind: "open", mode: "public" };
	}
	if (info === undefined) return null;
	if (info === null) return { kind: "inviteError", reason: "invalid" };
	if (info.projectId !== projectId)
		return { kind: "inviteError", reason: "otherProject" };
	if (info.roleGranted === "VIEWER") return { kind: "viewer", link: invite };
	if (record?.token) return { kind: "open", mode: "guest" };
	return { kind: "join", linkId: invite, info };
}

/** A resumed session only counts for the project the link was opened on. */
export function acceptsResume(routeId: string, resultId: string): boolean {
	return routeId === resultId;
}

export type ServerChoice =
	| { kind: "use"; baseUrl: string }
	| { kind: "confirm"; baseUrl: string; host: string }
	| { kind: "none" };

/**
 * Which server a project address talks to. The connected server always wins.
 * A server named only by a link is used when this phone already holds a guest
 * session for the project on it, or the person has confirmed its host; else
 * the person is asked first, because a link can name any server.
 */
export function serverFor(input: {
	connected: string | null;
	candidate: string | null;
	recordBase: string | null;
	confirmed: string | null;
}): ServerChoice {
	const { connected, candidate, recordBase, confirmed } = input;
	if (connected) return { kind: "use", baseUrl: connected };
	if (!candidate) return { kind: "none" };
	if (recordBase === candidate || confirmed === candidate)
		return { kind: "use", baseUrl: candidate };
	return {
		kind: "confirm",
		baseUrl: candidate,
		host: candidate.replace(/^https?:\/\//, ""),
	};
}
