import { toMinor } from "@retrospend/domain/money-minor";
import type { OutboxEntry, OutboxKind } from "@/data/outbox";
import { PARKED_CHAIN_LOST } from "@/data/outbox-chain";
import {
	KEY_REUSED,
	PARKED_ACCOUNT_CHANGED,
	PARKED_ID_TAKEN,
	PARKED_NO_STAMP,
	PARKED_NOT_FOUND,
	PARKED_STAMP,
	RECURRING_CHANGED,
} from "./send";

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
	/**
	 * False for an edit with no device booking (which fields it changed is
	 * unknown, so sending or re-basing it could lose or overwrite a change) and
	 * for a create the server holds another request under the key of (a resend
	 * under that key can never succeed). Discard only.
	 */
	retryable: boolean;
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

/** What a confirm books, from the device's booking of it (a fixed amount is not in the payload). */
function bookedConfirmAmount(entry: OutboxEntry): ParkedEntry["amount"] {
	if (entry.kind !== "confirm") return null;
	const row = entry.device?.changes.find((c) => c.table === "expenses")?.after;
	return row &&
		"amount" in row &&
		(typeof row.amount === "string" || typeof row.amount === "number") &&
		row.currency
		? safeMinor(String(row.amount), row.currency)
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
	// A transfer names what leaves the source (`fromAmount`, `fromCurrency`).
	const currencyText = body.currency ?? body.fromCurrency;
	const currency = typeof currencyText === "string" ? currencyText : "";
	const amountText = body.amount ?? body.fromAmount;
	const amount =
		typeof amountText === "string" && currency
			? safeMinor(amountText, currency)
			: (bookedAmount(entry) ?? bookedConfirmAmount(entry));
	// A template create names itself `name`; an edit of one keeps `title` for this row.
	const title = body.title ?? body.name ?? body.description;
	return {
		clientId: entry.clientId,
		title: typeof title === "string" ? title : "",
		amount,
		reason: entry.lastError ?? "refused",
		kind: entry.kind,
		gone,
		retryable: retryableOf(entry),
	};
}

/**
 * Whether sending the same entry again can come out differently. A template
 * create that met a taken id and an edit of a template that moved, was
 * deleted or has no stamp can only be refused again: Discard only (an edit
 * is saved over the new version by hand for now).
 */
function retryableOf(entry: OutboxEntry): boolean {
	const reason = entry.lastError ?? "";
	// A new account or transfer that met a taken id, and a whole-account edit
	// (its changed fields are unknown), can only be refused again.
	if (entry.entity === "accounts" || entry.entity === "transfers") {
		if (entry.kind === "create")
			return reason !== KEY_REUSED && reason !== PARKED_ID_TAKEN;
		return entry.kind !== "update";
	}
	if (entry.entity === "recurring" && entry.kind === "create")
		return reason !== KEY_REUSED && reason !== PARKED_ID_TAKEN;
	if (entry.entity === "recurring" && entry.kind === "update")
		return !REBASED_TEMPLATE.includes(reason);
	return entry.kind === "create"
		? reason !== KEY_REUSED
		: entry.kind !== "update" || entry.device !== undefined;
}

/** Why a write to an existing row was parked, that saving it again as it is cannot change. */
const REBASED = [PARKED_STAMP, PARKED_CHAIN_LOST, PARKED_NO_STAMP, KEY_REUSED];

/**
 * The same for a recurring confirm or skip. A template that was not found may
 * be back (an Undo put it back with the same id, which moved its stamp), so
 * sending the old stamp again would only be refused: it re-bases on the first
 * tap.
 */
const REBASED_TEMPLATE = [...REBASED, RECURRING_CHANGED, PARKED_NOT_FOUND];

/**
 * Whether Try again saves it over the row a pull brought, after a preview: an
 * edit or delete that met a newer row, lost the entry it was chained to, had
 * no stamp, or met a key the server holds for another request (resending it
 * as it is would answer the same, with the same key and stamp).
 */
export const rebases = (entry: ParkedEntry): boolean =>
	entry.kind === "confirm" || entry.kind === "skip"
		? REBASED_TEMPLATE.includes(entry.reason)
		: ACCOUNT_KINDS.includes(entry.kind)
			? REBASED_ACCOUNT.includes(entry.reason)
			: entry.kind !== "create" && REBASED.includes(entry.reason);

/** The kinds only an account has: each states one thing (a balance, a state, a type) that is saved again over the account as pulled. */
const ACCOUNT_KINDS: readonly OutboxKind[] = [
	"close",
	"reopen",
	"balance",
	"rateType",
];

/** Why an account write was parked, that saving it again over the pulled account can change. */
const REBASED_ACCOUNT = [
	PARKED_ACCOUNT_CHANGED,
	PARKED_STAMP,
	PARKED_CHAIN_LOST,
	PARKED_NO_STAMP,
	KEY_REUSED,
];
