import "server-only";

import { headers } from "next/headers";
import { getWebSession } from "~/server/better-auth/web-session";
import { isFlagEnabled } from "~/server/flags";

/**
 * The redesigned Budget shows for a viewer with uiV2 and the envelope budget
 * both on: the new page reads the envelope engine, which answers FORBIDDEN
 * without its flag. Either one off keeps today's page, unchanged.
 */
export async function newBudgetEnabled(): Promise<boolean> {
	const session = await getWebSession(await headers());
	const viewer = session?.user;
	return (
		(await isFlagEnabled("uiV2", viewer)) &&
		(await isFlagEnabled("envelopeBudget", viewer))
	);
}
