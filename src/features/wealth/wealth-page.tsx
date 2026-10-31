import "server-only";

import { cookies } from "next/headers";
import { loadWealthView } from "./server/load";
import { readSort, WEALTH_SORT_COOKIE } from "./sort";
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
	const sort = readSort((await cookies()).get(WEALTH_SORT_COOKIE)?.value);
	return <WealthScreen initialSort={sort} view={view} />;
}
