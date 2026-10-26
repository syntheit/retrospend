import type { Contract } from "@retrospend/api-contract";

/** A top-level group of the contract: `expenses`, `budget`, `needs-you`. */
export type ApiGroup = keyof Contract;

/**
 * Which query groups an event makes stale. This is the v1 twin of
 * `CROSS_ROUTER_INVALIDATIONS` in the web app's `src/lib/query-invalidation.ts`:
 * the same dependencies (a ledger write moves figures and the budget; a
 * shared write moves people, projects and balances), keyed by the event's
 * resource (`expense` in `expense.created`) instead of a tRPC mutation name,
 * so a write made on another device invalidates the same queries as one
 * made here.
 */
const LEDGER: readonly ApiGroup[] = [
	"expenses",
	"income",
	"transfers",
	"recurring",
	"figures",
	"needs-you",
	"activity",
	"accounts",
	"budget",
	"search",
];

/** Shared money: balances, projects, payments and what they do to spending. */
const PEOPLE_MONEY: readonly ApiGroup[] = [
	"people",
	"projects",
	"shared-expenses",
	"payments",
	"billing-periods",
	"corrections",
	"figures",
	"needs-you",
	"activity",
	"expenses",
	"budget",
	"accounts",
	"search",
];

/** A category change shows in every row that names the category. */
const CATEGORY: readonly ApiGroup[] = [
	"categories",
	"settings",
	"expenses",
	"shared-expenses",
	"projects",
	"figures",
	"budget",
	"activity",
	"recurring",
];

const BUDGET: readonly ApiGroup[] = [
	"budget",
	"expenses",
	"figures",
	"accounts",
	"needs-you",
	"activity",
	"projects",
];

const RATES: readonly ApiGroup[] = [
	"currencies",
	"settings",
	"entry",
	"accounts",
	"figures",
	"people",
	"projects",
	"expenses",
];

const IMPORT: readonly ApiGroup[] = [
	"imports",
	"expenses",
	"figures",
	"budget",
	"activity",
	"search",
];

/** The event resource (text before the dot) to the groups it makes stale. */
export const RESOURCE_GROUPS: Readonly<Record<string, readonly ApiGroup[]>> = {
	// Core
	category: CATEGORY,
	category_preference: ["settings", "figures"],
	favorite_rate: RATES,
	favorite_rates: RATES,
	default_rate_type: RATES,
	rates: RATES,
	notification: ["notifications"],
	notification_preferences: ["notifications"],
	needs_you: ["needs-you"],
	page_settings: ["settings"],
	settings: ["settings", "figures", "expenses", "budget", "activity"],
	payment_methods: ["payment-methods", "settings"],
	profile: ["profile", "platform", "account", "people"],
	push_device: ["push"],
	token: ["tokens"],
	webhook: ["webhooks"],
	// Ledger
	expense: LEDGER,
	expenses: LEDGER,
	income: LEDGER,
	recurring: LEDGER,
	transfer: LEDGER,
	// People and projects
	correction: PEOPLE_MONEY,
	fix_request: PEOPLE_MONEY,
	shared_expense: PEOPLE_MONEY,
	billing_period: PEOPLE_MONEY,
	payment: PEOPLE_MONEY,
	person: PEOPLE_MONEY,
	project: PEOPLE_MONEY,
	// Wealth
	account: ["accounts", "account", "figures", "budget", "expenses", "activity"],
	// Data and admin
	admin_ai_settings: ["admin", "settings"],
	admin_backup: ["admin"],
	admin_settings: ["admin", "settings", "platform"],
	admin_user: ["admin"],
	export: ["exports"],
	feedback: ["feedback", "admin"],
	import: IMPORT,
	invite_code: ["invite-codes", "admin"],
};

/** Every `budget_*` resource belongs to the budget, however many it grows. */
function groupsOfResource(resource: string): readonly ApiGroup[] | null {
	const exact = RESOURCE_GROUPS[resource];
	if (exact) return exact;
	if (resource === "budget" || resource.startsWith("budget_")) return BUDGET;
	return null;
}

export const EVERYTHING = "everything" as const;

export type Invalidation = readonly ApiGroup[] | typeof EVERYTHING;

/**
 * The groups an event type makes stale. `user.deleted` ends the account, and
 * a type this client has never heard of (a newer server) is not listed: both
 * refresh everything, so a new event can never leave a screen out of date.
 * The test in invalidation.test.ts fails while a known type has no entry.
 */
export function invalidationFor(eventType: string): Invalidation {
	const resource = eventType.split(".")[0] ?? "";
	if (resource === "user") return EVERYTHING;
	return groupsOfResource(resource) ?? EVERYTHING;
}
