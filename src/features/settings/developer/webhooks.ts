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
