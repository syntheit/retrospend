import "server-only";

import { loadWealthView } from "./server/load";
import { WealthScreen } from "./wealth-screen";
import { WealthUnavailable } from "./wealth-states";

/**
 * The Wealth page. The server reads today's procedures and
 * hands the client Money DTOs only; mutations refresh this read.
 */
export async function WealthPage() {
	let view: Awaited<ReturnType<typeof loadWealthView>>;
	try {
		view = await loadWealthView();
	} catch (error) {
		console.error("[wealth] the page could not load", error);
		return <WealthUnavailable />;
	}
	return <WealthScreen view={view} />;
}
