"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useSession } from "~/hooks/use-session";
import { api, type RouterOutputs } from "~/trpc/react";

export type InviteInfo = RouterOutputs["guest"]["validateLink"];

/** How the person reaches a project they are not a member of by account. */
export type Access =
	| { kind: "loading" }
	/** The resume link failed. */
	| { kind: "resumeFailed" }
	/** The invite does not work; `message` says why when it is not the plain case. */
	| { kind: "inviteError"; message?: string }
	/** A valid invite for someone who is not signed in: the join form. */
	| { kind: "join"; linkId: string; info: InviteInfo }
	| { kind: "guest" }
	| { kind: "viewer" }
	| { kind: "public" };

const GUEST_TOKEN = "guest_session_token";
const GUEST_PROJECT = "guest_project_id";
const VIEWER_LINK = "viewer_link_id";

function stripInviteParam() {
	const url = new URL(window.location.href);
	url.searchParams.delete("invite");
	window.history.replaceState({}, "", url.toString());
}

function hasGuestToken(projectId: string) {
	return (
		localStorage.getItem(GUEST_TOKEN) &&
		localStorage.getItem(GUEST_PROJECT) === projectId
	);
}

/**
 * What a visitor to a project page who is not a member by account is: a
 * guest with a token in this browser, a viewer with a link, a joiner with an
 * invite, or the public. The server renders the full page for members, so a
 * signed-in person who gets here is not one. The tokens stay in the
 * browser's storage, where the tRPC client reads them (src/trpc/react.tsx).
 */
export function useAccess(projectId: string): {
	access: Access;
	/** A viewer link that stopped working: look at the public page instead. */
	fallBackToPublic: () => void;
} {
	const t = useTranslations("projectShared");
	const search = useSearchParams();
	const inviteLinkId = search.get("invite");
	const resumeToken = search.get("guestResume");
	const session = useSession();
	const [access, setAccess] = useState<Access>({ kind: "loading" });
	const [inviteHandled, setInviteHandled] = useState(!inviteLinkId);

	// Resume link from the "you already joined" email: trade it for a fresh
	// guest session token, then reload into the guest view. The ref keeps it
	// to one call (the token is single-use) even if the effect runs twice.
	const resume = api.guest.resume.useMutation();
	const resumeStarted = useRef(false);
	useEffect(() => {
		if (!resumeToken || resumeStarted.current) return;
		resumeStarted.current = true;
		resume.mutate(
			{ token: resumeToken },
			{
				onSuccess: (data) => {
					localStorage.setItem(GUEST_TOKEN, data.sessionToken);
					localStorage.setItem(GUEST_PROJECT, data.projectId);
					window.location.replace(`/projects/${data.projectId}`);
				},
				onError: () => setAccess({ kind: "resumeFailed" }),
			},
		);
	}, [resumeToken, resume]);

	const link = api.guest.validateLink.useQuery(
		{ linkId: inviteLinkId ?? "" },
		{ enabled: !!inviteLinkId && !inviteHandled, retry: false },
	);
	// Signed-in people join with their own account (the server adds the
	// account behind this session). The ref keeps it to one call.
	const joinWithAccount = api.guest.joinWithAccount.useMutation();
	const joinStarted = useRef(false);

	useEffect(() => {
		if (!inviteLinkId || inviteHandled || link.isLoading) return;
		if (link.isError || !link.data) {
			setAccess({ kind: "inviteError" });
			return;
		}
		const info = link.data;
		if (info.projectId !== projectId) {
			setAccess({ kind: "inviteError", message: t("otherProject") });
			return;
		}
		if (info.roleGranted === "VIEWER") {
			localStorage.setItem(VIEWER_LINK, inviteLinkId);
			stripInviteParam();
			setInviteHandled(true);
			return;
		}
		// Wait for the session, so a signed-in person is not shown the form.
		if (session.isPending) return;
		if (session.data?.user) {
			if (joinStarted.current) return;
			joinStarted.current = true;
			joinWithAccount.mutate(
				{ linkId: inviteLinkId },
				{
					// The server renders the member's page on the next load.
					onSuccess: () => window.location.replace(`/projects/${projectId}`),
					onError: () => setAccess({ kind: "inviteError" }),
				},
			);
			return;
		}
		if (hasGuestToken(projectId)) {
			stripInviteParam();
			setInviteHandled(true);
			return;
		}
		setAccess({ kind: "join", linkId: inviteLinkId, info });
	}, [
		inviteLinkId,
		inviteHandled,
		link.isLoading,
		link.isError,
		link.data,
		session.isPending,
		session.data,
		joinWithAccount,
		projectId,
		t,
	]);

	// After the invite is handled (or when there is none): who is this?
	useEffect(() => {
		if (!inviteHandled || session.isPending || resumeToken) return;
		if (session.data?.user) setAccess({ kind: "public" });
		else if (hasGuestToken(projectId)) setAccess({ kind: "guest" });
		else if (localStorage.getItem(VIEWER_LINK)) setAccess({ kind: "viewer" });
		else setAccess({ kind: "public" });
	}, [inviteHandled, session.isPending, session.data, projectId, resumeToken]);

	return { access, fallBackToPublic: () => setAccess({ kind: "public" }) };
}
