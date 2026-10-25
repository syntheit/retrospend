import "server-only";

import { CurrenciesScreen } from "./currencies-screen";
import { CurrenciesUnavailable } from "./currencies-states";
import { loadCurrenciesView } from "./server/load";

/** The Currencies page: prices computed on the server. */
export async function CurrenciesPage({ initial }: { initial: string | null }) {
	let view: Awaited<ReturnType<typeof loadCurrenciesView>>;
	try {
		view = await loadCurrenciesView();
	} catch (error) {
		console.error("[currencies] the page could not load", error);
		return <CurrenciesUnavailable />;
	}
	return <CurrenciesScreen initial={initial} view={view} />;
}
