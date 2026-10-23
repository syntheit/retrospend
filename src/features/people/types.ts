/** What the People family reads from the server (src/server/services/people). */
export type {
	BalancePart,
	BarSegment,
	LedgerRowDTO,
	NeedsItemDTO,
	PaymentDTO,
	PeopleGroup,
	PeopleOverview,
	PersonIdentityDTO,
	PersonPage,
	PersonSummary,
	RateDTO,
	ScopeDTO,
} from "~/server/services/people/types";

/** Toolbar filters of the People list. */
export type PeopleFilters = {
	query: string;
	/** "Owes you" or "You owe" chip. */
	dir: "owed" | "owe" | null;
	/** "Not on Retrospend" chip. */
	notOnRetrospend: boolean;
};

export type PeopleSort = "balance" | "recent" | "name";

export const NO_PEOPLE_FILTERS: PeopleFilters = {
	query: "",
	dir: null,
	notOnRetrospend: false,
};
