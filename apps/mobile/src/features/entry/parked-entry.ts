import { toMinor } from "@retrospend/domain/money-minor";
import type { OutboxEntry } from "@/data/outbox";

export interface ParkedEntry {
	clientId: string;
	title: string;
	amount: { minor: number; currency: string } | null;
	/** The problem code the server answered with. */
	reason: string;
}

export function parkedFrom(entry: OutboxEntry): ParkedEntry {
	const body = (entry.payload ?? {}) as Record<string, unknown>;
	const currency = typeof body.currency === "string" ? body.currency : "";
	let amount: ParkedEntry["amount"] = null;
	try {
		if (typeof body.amount === "string" && currency) {
			amount = { minor: toMinor(body.amount, currency), currency };
		}
	} catch {
		// An amount that does not read stays out; the row still names the entry.
	}
	const title = body.title ?? body.description;
	return {
		clientId: entry.clientId,
		title: typeof title === "string" ? title : "",
		amount,
		reason: entry.lastError ?? "refused",
	};
}
