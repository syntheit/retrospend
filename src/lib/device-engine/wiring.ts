import { isProtected } from "@retrospend/api-contract/protection-state";
import type { DeviceController, DeviceUser } from "./controller";

/** The account the page is signed in as, from the session's user (null while signed out). */
export function deviceUser(
	user: { id: string } | null | undefined,
): DeviceUser | null {
	if (!user) return null;
	// A field the session carries at run time but the client's types do not name.
	const { protectionState } = user as { protectionState?: string };
	return { id: user.id, protectedAccount: isProtected(protectionState) };
}

/** The slice of `document` the tab wiring uses. */
export interface TabDocument {
	visibilityState: string;
	addEventListener(type: "visibilitychange", listener: () => void): void;
	removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Pulls when the tab comes to the front. The returned cleanup removes the
 * listener and signs the controller out, which ends the worker: it runs when
 * the dashboard layout unmounts, as it does when sign-out lands on the login page.
 */
export function bindTab(
	controller: DeviceController,
	doc: TabDocument,
): () => void {
	const onVisible = () => {
		if (doc.visibilityState === "visible") void controller.tabVisible();
	};
	doc.addEventListener("visibilitychange", onVisible);
	return () => {
		doc.removeEventListener("visibilitychange", onVisible);
		controller.setUser(null);
	};
}
