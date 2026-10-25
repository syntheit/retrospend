import type { WebhookDeliveryDto, WebhookDto } from "@retrospend/api-contract";
import { EVENT_TYPES } from "@retrospend/api-contract";
import type { StatusKind } from "~/components/ui/status-map";

/** One resource whose events a webhook can ask for: `expense` -> `expense.*`. */
export type EventResource = {
	resource: string;
	/** The filter that selects the whole resource. */
	filter: string;
	/** The events it covers, as the verb after the dot (created, updated). */
	verbs: string[];
};

/** Every resource in the contract's event list, in alphabetical order. */
export function eventResources(
	types: readonly string[] = EVENT_TYPES,
): EventResource[] {
	const by = new Map<string, string[]>();
	for (const type of types) {
		const [resource, verb] = type.split(".");
		if (!resource || !verb) continue;
		by.set(resource, [...(by.get(resource) ?? []), verb]);
	}
	return [...by.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([resource, verbs]) => ({
			resource,
			filter: `${resource}.*`,
			verbs: verbs.sort(),
		}));
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
	| { kind: "off"; status: StatusKind; reason: "manual" | "failures" | "blocked" };

export function stateOf(w: Pick<WebhookDto, "enabled" | "disabledReason">): WebhookState {
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
export function deliveryStatus(
	status: WebhookDeliveryDto["status"],
): { kind: StatusKind; word: "delivered" | "failed" | "pending" } {
	switch (status) {
		case "succeeded":
			return { kind: "confirmed", word: "delivered" };
		case "failed":
			return { kind: "error", word: "failed" };
		default:
			return { kind: "pending", word: "pending" };
	}
}
