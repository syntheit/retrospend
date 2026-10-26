import type { WebhookDeliveryDto, WebhookDto } from "@retrospend/api-contract";
import { EVENT_TYPES } from "@retrospend/api-contract";
import type { StatusKind } from "~/components/ui/status-map";

/**
 * The areas a person picks events by. Each holds the event resources it
 * covers; the area's name is a message (`settingsV2.developer.areas.<id>`),
 * so no raw API name reaches the picker. A resource missing here fails
 * webhooks.test.ts, which keeps a new event from being unselectable.
 */
export const EVENT_AREAS = {
	expenses: ["expense", "expenses"],
	income: ["income"],
	transfers: ["transfer"],
	recurring: ["recurring"],
	categories: ["category", "category_preference"],
	rates: ["rates", "favorite_rate", "favorite_rates", "default_rate_type"],
	people: ["person"],
	sharedExpenses: ["shared_expense", "correction", "fix_request"],
	payments: ["payment"],
	projects: ["project", "billing_period"],
	accounts: ["account"],
	budget: ["budget"],
	notifications: ["notification", "notification_preferences", "needs_you"],
	settings: ["settings", "page_settings", "payment_methods"],
	profile: ["profile", "user"],
	devices: ["push_device"],
	keys: ["token"],
	webhooks: ["webhook"],
	imports: ["import"],
	exports: ["export"],
	admin: ["invite_code", "feedback"],
} as const satisfies Record<string, readonly string[]>;

export type EventAreaId = keyof typeof EVENT_AREAS;

const AREA_IDS = Object.keys(EVENT_AREAS) as EventAreaId[];

/** Every `budget_*` and `admin_*` resource belongs to its area, however many it grows. */
export function areaOfResource(resource: string): EventAreaId | null {
	if (resource === "budget" || resource.startsWith("budget_")) return "budget";
	if (resource.startsWith("admin_")) return "admin";
	for (const id of AREA_IDS)
		if ((EVENT_AREAS[id] as readonly string[]).includes(resource)) return id;
	return null;
}

export type EventArea = {
	id: EventAreaId;
	/** The `resource.*` filters that select the whole area. */
	filters: string[];
};

/** The areas that have events in the contract's list, with their filters. */
export function eventAreas(
	types: readonly string[] = EVENT_TYPES,
): EventArea[] {
	const by = new Map<EventAreaId, Set<string>>();
	for (const type of types) {
		const resource = type.split(".")[0] ?? "";
		const id = areaOfResource(resource);
		if (!id) continue;
		by.set(id, (by.get(id) ?? new Set<string>()).add(`${resource}.*`));
	}
	return AREA_IDS.filter((id) => by.has(id)).map((id) => ({
		id,
		filters: [...(by.get(id) ?? [])].sort(),
	}));
}

const inArea = (id: EventAreaId, filter: string) =>
	areaOfResource(filter.split(".")[0] ?? "") === id;

/**
 * The filters after checking or unchecking one area in the picker. Checking
 * puts back what the webhook had for that area when it had any (a narrow
 * `expense.created` stays narrow), and gives an area it never had all its
 * events, so a round trip of uncheck and check changes nothing.
 */
export function toggleArea(
	value: readonly string[],
	area: EventArea,
	on: boolean,
	original: readonly string[] = [],
): string[] {
	const rest = value.filter((f) => !inArea(area.id, f));
	if (!on) return rest;
	const had = original.filter((f) => inArea(area.id, f));
	return [...rest, ...(had.length > 0 ? had : area.filters)];
}

export type AreaScope = "all" | "some" | { count: number };

/**
 * How much of each area a webhook's filters cover: all of it, a few exact
 * events (a count), or part of it through a wildcard that does not reach the
 * whole area. So a change line can show a real widening.
 */
export function areaScopes(
	filters: readonly string[],
): { id: EventAreaId; scope: AreaScope }[] {
	const whole = new Map(eventAreas().map((a) => [a.id, a.filters]));
	return areasOfFilters(filters).map((id) => {
		const mine = filters.filter((f) => inArea(id, f));
		const all = (whole.get(id) ?? []).every((f) => mine.includes(f));
		const exact = mine.every((f) => !f.endsWith(".*"));
		return {
			id,
			scope: all ? "all" : exact ? { count: mine.length } : "some",
		};
	});
}

/** The areas a webhook's filters (`expense.*` or `expense.created`) fall in. */
export function areasOfFilters(filters: readonly string[]): EventAreaId[] {
	const seen = new Set<EventAreaId>();
	for (const f of filters) {
		const id = areaOfResource(f.split(".")[0] ?? "");
		if (id) seen.add(id);
	}
	return AREA_IDS.filter((id) => seen.has(id));
}

/** Short codes of a failed delivery that have words (`settingsV2.developer.deliveryError.<code>`). */
export const DELIVERY_ERRORS = [
	"blocked_target",
	"dns_failed",
	"timeout",
	"connection_refused",
	"tls_error",
	"connection_error",
	"http_error",
	"secret_unreadable",
	"internal_error",
	"webhook_disabled",
	"event_gone",
] as const;

/**
 * How long Rotate secret keeps the old secret signing next to the new one:
 * not at all (the default, for a leaked secret), or one of these (seconds).
 * The API takes 0 to seven days; four choices is what Segmented holds.
 */
export const GRACE_CHOICES = [0, 3600, 86_400, 604_800] as const;
export type GraceSeconds = (typeof GRACE_CHOICES)[number];

const GRACE_KEYS = {
	0: "now",
	3600: "hour",
	86400: "day",
	604800: "week",
} as const satisfies Record<GraceSeconds, string>;

/** The message key of a grace choice (`settingsV2.developer.rotate.grace.<key>`). */
export function graceKey(seconds: GraceSeconds) {
	return GRACE_KEYS[seconds];
}

/** What the edit sheet changes about a webhook. */
export type WebhookEdit = Pick<
	WebhookDto,
	"name" | "url" | "eventTypes" | "enabled"
>;

const sameEvents = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((f) => b.includes(f));

/**
 * The fields of `next` that differ from `w`, for the update call. The URL is
 * trimmed (pasted addresses carry spaces); the name is user text and goes as
 * typed, compared as typed.
 */
export function editPatch(
	w: WebhookEdit,
	next: WebhookEdit,
): Partial<WebhookEdit> {
	const patch: Partial<WebhookEdit> = {};
	const url = next.url.trim();
	if (next.name !== w.name) patch.name = next.name;
	if (url !== w.url) patch.url = url;
	if (!sameEvents(w.eventTypes, next.eventTypes))
		patch.eventTypes = next.eventTypes;
	if (next.enabled !== w.enabled) patch.enabled = next.enabled;
	return patch;
}

/** What the update call takes beyond an edit: why a webhook is off, and since when. */
export type WebhookRestore = Partial<WebhookEdit> & {
	disabledReason?: NonNullable<WebhookDto["disabledReason"]>;
	disabledAt?: NonNullable<WebhookDto["disabledAt"]>;
};

/**
 * The update that puts back what `patch` replaced. Turning a webhook on
 * clears why it was off; putting it back off restores that reason (it may
 * have been switched off after failures, not by its owner).
 */
export function undoPatch(
	w: WebhookEdit & Partial<Pick<WebhookDto, "disabledReason" | "disabledAt">>,
	patch: Partial<WebhookEdit>,
): WebhookRestore {
	const back: WebhookRestore = {};
	if (patch.name !== undefined) back.name = w.name;
	if (patch.url !== undefined) back.url = w.url;
	if (patch.eventTypes !== undefined) back.eventTypes = w.eventTypes;
	if (patch.enabled !== undefined) {
		back.enabled = w.enabled;
		if (!w.enabled && w.disabledReason && w.disabledAt) {
			back.disabledReason = w.disabledReason;
			back.disabledAt = w.disabledAt;
		}
	}
	return back;
}

/** A webhook's target for display: the origin only, since a URL path often holds a secret. */
export function targetOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return url;
	}
}

/** Whether a string is an http(s) URL the form may send (the server checks the rest). */
export function isWebhookUrl(value: string): boolean {
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

/** How a webhook shows its state: nothing while it works, a word when it is off. */
export type WebhookState =
	| { kind: "active" }
	| {
			kind: "off";
			status: StatusKind;
			reason: "manual" | "failures" | "blocked";
	  };

export function stateOf(
	w: Pick<WebhookDto, "enabled" | "disabledReason">,
): WebhookState {
	if (w.enabled) return { kind: "active" };
	switch (w.disabledReason) {
		case "too_many_failures":
			return { kind: "off", status: "error", reason: "failures" };
		case "blocked_target":
			return { kind: "off", status: "error", reason: "blocked" };
		default:
			return { kind: "off", status: "notCounted", reason: "manual" };
	}
}

/** A delivery's status kind from the one status map. */
export function deliveryStatus(status: WebhookDeliveryDto["status"]): {
	kind: StatusKind;
	word: "delivered" | "failed" | "pending";
} {
	switch (status) {
		case "succeeded":
			return { kind: "confirmed", word: "delivered" };
		case "failed":
			return { kind: "error", word: "failed" };
		default:
			return { kind: "pending", word: "pending" };
	}
}
