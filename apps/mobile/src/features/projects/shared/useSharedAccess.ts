import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerConnection } from "@/auth/server-connection";
import { createGuestApi, GuestApiError, type InviteInfo } from "./guestApi";
import {
	clearGuestRecord,
	readGuestRecord,
	writeGuestRecord,
} from "./guestStore";
import {
	type GuestRecord,
	type SharedMode,
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
	| { status: "join"; linkId: string; info: InviteInfo }
	| { status: "open"; mode: SharedMode; record: GuestRecord | null };

/**
 * Who this phone is in a project it has no seat in. A resume link from the
 * "you already joined" email trades for a new session; an invite is read and
 * either asks to join, remembers a viewer link, or opens the guest page the
 * phone already holds; without one the phone shows what it holds, or the
 * public page. The server is the connected one, or the one the address names
 * (a guest has no connection of their own).
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
	const baseUrl = connected ?? serverParam(options.server);
	const [access, setAccess] = useState<SharedAccess>({ status: "loading" });
	const { projectId, invite, resume } = options;

	const open = useCallback(
		(mode: SharedMode, record: GuestRecord | null) =>
			setAccess({ status: "open", mode, record }),
		[],
	);

	useEffect(() => {
		let live = true;
		const settle = (next: SharedAccess) => {
			if (live) setAccess(next);
		};
		if (connection.status === "loading") return;
		if (!baseUrl) {
			settle({ status: "failed", reason: "noServer" });
			return () => {
				live = false;
			};
		}
		const api = createGuestApi(baseUrl);
		(async () => {
			let record = await readGuestRecord(projectId);
			if (record && record.baseUrl !== baseUrl) record = null;
			if (resume) {
				try {
					const out = await api.resume(resume);
					record = {
						baseUrl,
						projectId: out.projectId,
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
					if (error instanceof GuestApiError && error.code === "TOO_MANY_REQUESTS") {
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
					baseUrl,
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
		})();
		return () => {
			live = false;
		};
	}, [connection.status, baseUrl, projectId, invite, resume]);

	const forget = useCallback(async () => {
		await clearGuestRecord(projectId);
	}, [projectId]);

	return useMemo(
		() => ({ access, baseUrl, open, forget }),
		[access, baseUrl, open, forget],
	);
}
