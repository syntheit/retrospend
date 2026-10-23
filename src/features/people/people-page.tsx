import "server-only";

import { dayKey } from "~/lib/time-zone";
import { api } from "~/trpc/server";
import { PeopleScreen } from "./people-screen";
import { PeopleUnavailable } from "./people-states";

/**
 * The redesigned People page (uiV2). The server reads people.overview and
 * hands the client Money DTOs only; mutations refresh this read.
 */
export async function PeoplePage() {
	let view: Awaited<ReturnType<typeof api.people.overview>>;
	try {
		view = await api.people.overview();
	} catch (error) {
		console.error("[people] the page could not load", error);
		return <PeopleUnavailable />;
	}
	return <PeopleScreen today={dayKey(new Date())} view={view} />;
}
