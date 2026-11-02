import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerConnection } from "@/auth/server-connection";
import { createGuestApi, GuestApiError, type InviteInfo } from "./guestApi";
import {
	clearGuestRecord,
	readGuestRecord,
	writeGuestRecord,
} from "./guestStore";
import {
	acceptsResume,
	type GuestRecord,
	type SharedMode,
	serverFor,
	serverParam,
	stepFor,
} from "./sharedAccess";

export type SharedFailure =
	| "noServer"
	| "resumeFailed"
	| "inviteInvalid"
	| "otherProject"
	| "busy";

export type SharedAccess =
	| { status: "loading" }
	| { status: "failed"; reason: SharedFailure }
	/** The link names a server this phone does not know: ask before talking to it. */
	| { status: "confirmServer"; host: string; baseUrl: string }
	| { status: "join"; linkId: string; info: InviteInfo }
	| { status: "open"; mode: SharedMode; record: GuestRecord | null };

/**
 * Who this phone is in a project it has no seat in. A resume link from the
 * "you already joined" email trades for a new session (only for this
 * project); an invite is read and either asks to join, remembers a viewer
 * link, or opens the guest page the phone already holds; without one the
 * phone shows what it holds, or the public page. The server is the connected
 * one; a guest with no connection uses the server the link names, once the
 * person has confirmed its host (or the phone already holds a session there).
 */
export function useSharedAccess(options: {
	projectId: string;
	invite: string | null;
	resume: string | null;
	server: string | null;
}) {
	const { connection } = useServerConnection();
	const connected =
		connection.status === "connected" ? connection.baseUrl : null;
	const [confirmed, setConfirmed] = useState<string | null>(null);
	const [access, setAccess] = useState<SharedAccess>({ status: "loading" });
	const { projectId, invite, resume, server } = options;
	const baseUrl = connected ?? confirmed;

	const open = useCallback(
		(mode: SharedMode, record: GuestRecord | null) =>
			setAccess({ status: "open", mode, record }),
		[],
	);
	const confirmServer = useCallback((url: string) => setConfirmed(url), []);

	useEffect(() => {
		let live = true;
		const settle = (next: SharedAccess) => {
			if (live) setAccess(next);
		};
		if (connection.status === "loading") return;

		async function run(base: string) {
			const api = createGuestApi(base);
			let record = await readGuestRecord(projectId);
			if (record && record.baseUrl !== base) record = null;
			if (resume) {
				try {
					const out = await api.resume(resume);
					// A link may only bring back a session for the project it opens.
					if (!acceptsResume(projectId, out.projectId)) throw new Error("other");
					record = {
						baseUrl: base,
						projectId,
						projectName: record?.projectName ?? null,
						token: out.sessionToken,
						sessionId: out.guestSessionId,
						viewerLink: null,
						name: record?.name ?? null,
					};
					await writeGuestRecord(record);
				} catch {
					settle({ status: "failed", reason: "resumeFailed" });
					return;
				}
			}
			let info: InviteInfo | null | undefined;
			if (invite && !resume) {
				try {
					info = await api.validateLink(invite);
				} catch (error) {
					if (
						error instanceof GuestApiError &&
						error.code === "TOO_MANY_REQUESTS"
					) {
						settle({ status: "failed", reason: "busy" });
						return;
					}
					info = null;
				}
			}
			const step = stepFor({
				projectId,
				invite: resume ? null : invite,
				info,
				record,
			});
			if (!step) return;
			if (step.kind === "inviteError") {
				settle({
					status: "failed",
					reason:
						step.reason === "otherProject" ? "otherProject" : "inviteInvalid",
				});
			} else if (step.kind === "join") {
				settle({ status: "join", linkId: step.linkId, info: step.info });
			} else if (step.kind === "viewer") {
				const saved: GuestRecord = {
					baseUrl: base,
					projectId,
					projectName: info?.projectName ?? record?.projectName ?? null,
					token: null,
					sessionId: null,
					viewerLink: step.link,
					name: null,
				};
				await writeGuestRecord(saved);
				settle({ status: "open", mode: "viewer", record: saved });
			} else {
				settle({
					status: "open",
					mode: step.mode,
					record: step.mode === "public" ? null : record,
				});
			}
		}

		(async () => {
			const candidate = serverParam(server);
			const stored =
				!connected && candidate ? await readGuestRecord(projectId) : null;
			const choice = serverFor({
				connected,
				candidate,
				recordBase: stored?.baseUrl ?? null,
				confirmed,
			});
			if (choice.kind === "none") {
				settle({ status: "failed", reason: "noServer" });
			} else if (choice.kind === "confirm") {
				settle({
					status: "confirmServer",
					host: choice.host,
					baseUrl: choice.baseUrl,
				});
			} else if (choice.baseUrl !== baseUrl) {
				// The phone already holds a session on this server: carry on with it.
				if (live) setConfirmed(choice.baseUrl);
			} else {
				await run(choice.baseUrl);
			}
		})();
		return () => {
			live = false;
		};
	}, [
		connection.status,
		connected,
		confirmed,
		baseUrl,
		projectId,
		invite,
		resume,
		server,
	]);

	const forget = useCallback(async () => {
		await clearGuestRecord(projectId);
	}, [projectId]);

	return useMemo(
		() => ({ access, baseUrl, open, forget, confirmServer }),
		[access, baseUrl, open, forget, confirmServer],
	);
}
