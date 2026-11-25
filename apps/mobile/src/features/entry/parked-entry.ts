import { toMinor } from "@retrospend/domain/money-minor";
import type { OutboxEntry, OutboxKind } from "@/data/outbox";
import { PARKED_CHAIN_LOST } from "@/data/outbox-chain";
import { PARKED_STAMP } from "./send";

export interface ParkedEntry {
	clientId: string;
	/** Empty for a delete: its entry names the row by id only. */
	title: string;
	amount: { minor: number; currency: string } | null;
	/** The problem code the server answered with. */
	reason: string;
	kind: OutboxKind;
	/** A pull showed the row is gone, so an edit of it cannot be saved. */
	gone: boolean;
}

/** The amount a delete removes, from the device's booking of it (the payload names only the id). */
function bookedAmount(entry: OutboxEntry): ParkedEntry["amount"] {
	const row = entry.device?.changes[0]?.before as
		| { amount?: unknown; currency?: unknown }
		| null
		| undefined;
	const currency = typeof row?.currency === "string" ? row.currency : "";
	return entry.kind === "delete" &&
		(typeof row?.amount === "string" || typeof row?.amount === "number") &&
		currency
		? safeMinor(String(row.amount), currency)
		: null;
}

function safeMinor(amount: string, currency: string): ParkedEntry["amount"] {
	try {
		return { minor: toMinor(amount, currency), currency };
	} catch {
		// An amount that does not read stays out; the row still names the entry.
		return null;
	}
}

export function parkedFrom(entry: OutboxEntry, gone = false): ParkedEntry {
	const body = (entry.payload ?? {}) as Record<string, unknown>;
	const currency = typeof body.currency === "string" ? body.currency : "";
	const amount =
		typeof body.amount === "string" && currency
			? safeMinor(body.amount, currency)
			: bookedAmount(entry);
	const title = body.title ?? body.description;
	return {
		clientId: entry.clientId,
		title: typeof title === "string" ? title : "",
		amount,
		reason: entry.lastError ?? "refused",
		kind: entry.kind,
		gone,
	};
}

/**
 * Whether Try again saves it over the row a pull brought, after a preview: an
 * edit or delete that met a newer row, or lost the entry it was chained to
 * (resending it as it is could not change the answer).
 */
export const rebases = (entry: ParkedEntry): boolean =>
	entry.kind !== "create" &&
	(entry.reason === PARKED_STAMP || entry.reason === PARKED_CHAIN_LOST);
