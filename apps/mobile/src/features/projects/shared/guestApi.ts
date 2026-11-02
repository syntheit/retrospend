import type { ProjectPage } from "../source";

// The calls of a person with no account on the server: an invite link, a guest
// session and the public page. They stay on the server's tRPC endpoint (the
// guest sessions are not part of API v1), so this is a small client of its
// wire format: `{ json: input }` in, `result.data.json` out. A guest sends
// the session token, a viewer link its id, in the same headers the web page
// sends.

export type GuestErrorCode =
	| "NOT_FOUND"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "TOO_MANY_REQUESTS"
	| "BAD_REQUEST"
	| "UNKNOWN";

export class GuestApiError extends Error {
	constructor(
		readonly code: GuestErrorCode,
		readonly status: number,
	) {
		super(code);
	}
}

/** What an invite shows before anyone joins. */
export interface InviteInfo {
	projectId: string;
	projectName: string;
	projectDescription: string | null;
	projectImagePath: string | null;
	participantCount: number;
	roleGranted: string;
}

/** Someone in the project nobody has claimed yet. */
export interface Ghost {
	id: string;
	name: string;
	linkable: boolean;
}

export type Registered =
	| { resumeEmailSent: true; projectId: string; projectName: string }
	| {
			resumeEmailSent: false;
			sessionToken: string;
			guestSessionId: string;
			projectId: string;
			projectName: string;
			role: string;
	  };

export interface Resumed {
	sessionToken: string;
	guestSessionId: string;
	projectId: string;
}

export interface GuestCredentials {
	/** The guest's session token. */
	token?: string | null;
	/** The viewer link's id. */
	viewerLink?: string | null;
}

const CODES: ReadonlySet<string> = new Set([
	"NOT_FOUND",
	"UNAUTHORIZED",
	"FORBIDDEN",
	"TOO_MANY_REQUESTS",
	"BAD_REQUEST",
]);

type Wire = {
	result?: { data?: { json?: unknown } };
	error?: { json?: { data?: { code?: string } } };
};

export function createGuestApi(
	baseUrl: string,
	credentials: GuestCredentials = {},
	fetchImpl: typeof fetch = fetch,
) {
	const root = `${baseUrl.replace(/\/+$/, "")}/api/trpc`;
	const headers = (): Record<string, string> => ({
		"content-type": "application/json",
		...(credentials.token ? { "x-guest-token": credentials.token } : {}),
		...(credentials.viewerLink
			? { "x-viewer-link-id": credentials.viewerLink }
			: {}),
	});

	async function read<T>(response: Response): Promise<T> {
		let body: Wire | null = null;
		try {
			body = (await response.json()) as Wire;
		} catch {
			body = null;
		}
		if (!response.ok || !body || body.error) {
			const code = body?.error?.json?.data?.code ?? "";
			throw new GuestApiError(
				CODES.has(code) ? (code as GuestErrorCode) : "UNKNOWN",
				response.status,
			);
		}
		return body.result?.data?.json as T;
	}

	const query = <T>(path: string, input: unknown) =>
		fetchImpl(
			`${root}/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
			{ headers: headers() },
		).then((r) => read<T>(r));
	const mutate = <T>(path: string, input: unknown) =>
		fetchImpl(`${root}/${path}`, {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ json: input }),
		}).then((r) => read<T>(r));

	return {
		validateLink: (linkId: string) =>
			query<InviteInfo>("guest.validateLink", { linkId }),
		ghosts: (linkId: string) =>
			query<Ghost[]>("claim.projectGhosts", { linkId }),
		register: (input: { linkId: string; name: string; email: string }) =>
			mutate<Registered>("guest.register", input),
		/** Takes over a ghost's history; needs the guest's own token in the credentials. */
		claim: (input: {
			linkId: string;
			guestSessionId: string;
			shadowId: string;
		}) => mutate<unknown>("claim.linkGuestToGhost", input),
		resume: (token: string) => mutate<Resumed>("guest.resume", { token }),
		/** The page of a guest or a viewer link (credentials in the headers). */
		sharedPage: (id: string) =>
			query<ProjectPage>("project.sharedPageView", { id }),
		/** The public page; null when the project is not public. */
		publicPage: (id: string) =>
			query<ProjectPage | null>("project.publicPageView", { id }),
	};
}

export type GuestApi = ReturnType<typeof createGuestApi>;
