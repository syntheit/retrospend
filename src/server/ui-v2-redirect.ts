import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

/** The `searchParams` prop of a page (a promise since Next 15). */
export type PageSearchParams = Promise<
	Record<string, string | string[] | undefined>
>;

/** `path` with the query of the old URL, so a bookmarked filter survives. */
export function withQuery(
	path: string,
	params: Record<string, string | string[] | undefined>,
): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item !== undefined) query.append(key, item);
		}
	}
	const search = query.toString();
	return search ? `${path}?${search}` : path;
}

/** Whether the signed-in viewer sees the new UI (the uiV2 flag). */
export async function isUiV2On(): Promise<boolean> {
	const session = await getWebSession(await headers());
	return isFlagEnabled("uiV2", session?.user);
}

/**
 * Sends the viewer from a route the redesign renamed to its new route, with
 * the query kept. Only when uiV2 is on for them; with the flag off it returns
 * and the old page renders. This is a route-level check, not proxy.ts: the
 * flag depends on the viewer's role and the app settings, and Next's proxy
 * must not lean on the database. The redirect is temporary (307) because the
 * flag can go back off.
 */
export async function redirectIfUiV2(
	to: string,
	searchParams: PageSearchParams,
): Promise<void> {
	if (await isUiV2On()) redirect(withQuery(to, await searchParams));
}
