import "server-only";

import { api, HydrateClient } from "~/trpc/server";
import { HomeScreen } from "./home-screen";
import { RECENT_INPUT } from "./recent-input";

/**
 * The redesigned Home (uiV2). Its reads go out with the HTML: the glance
 * and Needs you (one server read each), the last expenses (Activity's
 * read), and the rail's people and recurring reads. The client keeps them
 * fresh after any change (use-home-refresh). A read that fails is not sent,
 * so the client asks again and shows that part as unavailable (R14).
 */
export async function HomePage() {
	await Promise.all([
		api.home.glance.prefetch(),
		api.home.needsYou.prefetch(),
		api.expense.listV2.prefetch(RECENT_INPUT),
		api.people.overview.prefetch(),
		api.recurring.listView.prefetch(),
	]);
	return (
		<HydrateClient>
			<HomeScreen />
		</HydrateClient>
	);
}
