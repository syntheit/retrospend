"use client";

import { JoinFlow } from "./join-flow";
import { SharedScreen } from "./shared-screen";
import {
	InvalidInvite,
	LinkExpired,
	SharedLoading,
} from "./states";
import { useAccess } from "./use-access";

/**
 * The project page for anyone who is not a member by account: a guest, a
 * viewer link, an invite, a resume link or the public. Today's shell stays
 * out of it; the tokens live in this browser, so the page is client side and
 * reads through the guest procedures (x-guest-token, x-viewer-link-id).
 */
export function SharedProjectPage({ id }: { id: string }) {
	const { access, fallBackToPublic } = useAccess(id);
	switch (access.kind) {
		case "loading":
			return <SharedLoading />;
		case "resumeFailed":
			return <LinkExpired />;
		case "inviteError":
			return <InvalidInvite message={access.message} />;
		case "join":
			return <JoinFlow info={access.info} linkId={access.linkId} projectId={id} />;
		default:
			return (
				<SharedScreen
					access={access.kind}
					id={id}
					onViewerFailed={fallBackToPublic}
				/>
			);
	}
}
