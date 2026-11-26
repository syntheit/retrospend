import type { WriteBody, WriteOp } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { newClientId } from "@/data/ids";
import type { Outbox, OutboxEntry } from "@/data/outbox";
import { deviceOf, exclusive } from "./queue";
import { type RecurringPayload, recurringPayloadOf } from "./send";
import { settleOpOf } from "./settleOp";

// Try again on a parked edit or delete that met another device's change. The
// write is saved again over the row a pull brought: the pulled row becomes the
// full PUT body (the domain's putBodyOf, in the account's zone, read by the
// engine), and only the fields this phone changed are laid over it. It is a
// new write under a new key, checked against the pulled version, and it is
// previewed before it is sent. A person's recurring confirm or skip is saved
// again the same way, over the template a pull brought, while the period it
// names is still the template's next one.

/** The rate fields travel as one group: a body never carries both a type and a typed rate. */
const RATE = ["rateType", "customRate"] as const;
const RATE_TRIGGERS = ["currency", ...RATE];

/**
 * `pulled` with this phone's value for each name in `changed`. A changed name
 * the payload leaves out is a cleared field. A change to the currency or the
 * rate takes the payload's whole rate group, so the pulled row's rate for the
 * old currency never rides along.
 */
export function rebasedBody(
	pulled: Record<string, unknown>,
	payload: Record<string, unknown>,
	changed: readonly string[],
): Record<string, unknown> {
	const names = new Set(changed);
	if (changed.some((n) => RATE_TRIGGERS.includes(n)))
		for (const n of RATE) names.add(n);
	const body = { ...pulled };
	for (const name of names) {
		if (name in payload) body[name] = payload[name];
		else delete body[name];
	}
	return body;
}

export interface RebasePlan {
	/** A re-based write is an expense edit or delete, or a confirm or skip: a template edit is discarded, not re-based. */
	op: Exclude<WriteOp, { kind: "templateCreate" | "templateUpdate" }>;
	/** The pulled version the new write is checked against. */
	version: string;
	/** What the new entry sends. */
	payload: Record<string, unknown>;
}

/**
 * Whether a typed amount still belongs to the template as a pull left it. The
 * confirm body carries no currency, so an amount typed for ARS would book as
 * USD if the template's currency changed since, and a template that no longer
 * asks for an amount refuses one. The one owner of this rule: Try again and the
 * Sync issues row (Discard only) both read it.
 */
export function typedAmountFits(
	payload: Pick<RecurringPayload, "amount" | "currency">,
	seen: { currency: string; amountMode: "FIXED" | "ASK" },
): boolean {
	return (
		payload.amount === undefined ||
		(seen.amountMode === "ASK" && seen.currency === payload.currency)
	);
}

/**
 * A parked confirm or skip, saved again over the template as the last pull
 * left it. Only a template that is there, active, versioned and still due on
 * the entry's period re-bases: any other (gone, paused, the period posted,
 * skipped or moved) leaves Discard only. Null before a pull has finished.
 */
async function planSettle(
	writes: DeviceWrites,
	entry: OutboxEntry,
): Promise<RebasePlan | null> {
	if (entry.kind !== "confirm" && entry.kind !== "skip") return null;
	const payload = recurringPayloadOf(entry);
	if (!payload) return null;
	const seen = await writes.templateSince(
		entry.targetId,
		0,
		new Date(payload.dueAt),
		entry.clientId,
	);
	if (!seen?.found || seen.paused || seen.passed || !seen.version) return null;
	if (!typedAmountFits(payload, seen)) return null;
	return {
		// The new expense id is made when the entry is replaced.
		op: settleOpOf(
			entry.kind,
			{ ...payload, id: entry.targetId },
			entry.clientId,
		),
		version: seen.version,
		payload: { ...payload },
	};
}

/**
 * What Try again would save, or null when it cannot be read: the entry is not
 * a parked update or delete of an expense (or a confirm or skip of a
 * template), or the device has no whole, versioned copy of the row. Never a
 * guess.
 */
export async function planRebase(input: {
	outbox: Outbox;
	writes: DeviceWrites;
	clientId: string;
}): Promise<RebasePlan | null> {
	const { outbox, writes, clientId } = input;
	const entry = (await outbox.all()).find((e) => e.clientId === clientId);
	if (entry?.state !== "conflict" || entry.kind === "create") return null;
	if (entry.entity === "recurring") return planSettle(writes, entry);
	if (entry.entity !== "expenses") return null;
	const stored = await writes.storedRebase(entry.targetId);
	if (!stored) return null;
	if (entry.kind === "delete") {
		return {
			op: { kind: "delete", id: entry.targetId },
			version: stored.version,
			payload: { id: entry.targetId },
		};
	}
	// Which fields this phone changed is known only from its booking. Without
	// one an edit would read as no change at all, and lose it: never re-based.
	if (!entry.device) return null;
	const body = rebasedBody(
		{ ...stored.body },
		(entry.payload ?? {}) as Record<string, unknown>,
		entry.device.changed,
	);
	return {
		op: { kind: "update", body: body as unknown as WriteBody },
		version: stored.version,
		payload: body,
	};
}

/**
 * Swaps the parked entry for the re-based one: a fresh `clientId` (the old key
 * holds the old request, and a confirm's expense id), the same row, the pulled
 * version as its base, and the device's booking of it. Entries after it for the row are parked by the
 * outbox: each is re-based on its own. Returns the new client id, or null when
 * the entry is not parked any more, or an edit the device could not book (its
 * changed fields would be lost).
 */
export function commitRebase(input: {
	outbox: Outbox;
	writes: DeviceWrites;
	clientId: string;
	plan: RebasePlan;
}): Promise<string | null> {
	const { outbox, writes, clientId, plan } = input;
	return exclusive(outbox, async () => {
		const old = (await outbox.all()).find((e) => e.clientId === clientId);
		if (old?.state !== "conflict") return null;
		const next = newClientId();
		// A confirm books its expense under the new entry's id.
		const op =
			plan.op.kind === "confirm"
				? { ...plan.op, body: { ...plan.op.body, expenseId: next } }
				: plan.op;
		const booked = await writes.book(op);
		if (plan.op.kind === "update" && !booked) return null;
		await outbox.replace(clientId, {
			clientId: next,
			entity: old.entity,
			kind: old.kind,
			targetId: old.targetId,
			baseVersion: plan.version,
			payload: plan.payload,
			...(old.origin ? { origin: old.origin } : {}),
			...(booked ? { device: deviceOf(booked) } : {}),
		});
		await writes.refresh().catch(() => undefined);
		return next;
	});
}
