// A Retrospend share or join link that reaches the app. The guest join flow
// and the public page are web pages (they are for people without the app), so
// a link to a project you are not in opens that page in the in-app browser. A
// project you are already in opens as itself.

export interface LinkRead {
	/** The project arrived by a link (retrospend://projects/ID, or its web address). */
	fromLink: boolean;
	status: "loading" | "ready" | "error";
	/** The page is the cache's and the server has not answered yet. */
	refreshing: boolean;
	myRole: string | null;
}

/**
 * Whether to send this link to the web page: it came by a link, the server
 * has answered, and you are not a member (the read failed, or it came back
 * with no role of yours, which is the public page).
 */
export function opensWebPage(read: LinkRead): boolean {
	if (!read.fromLink) return false;
	if (read.status === "loading") return false;
	if (read.status === "error") return true;
	if (read.refreshing) return false;
	return read.myRole === null;
}
