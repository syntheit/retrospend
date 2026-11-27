import type { RetrospendClient } from "@retrospend/api-client";
import type { OutboxEntry } from "@/data/outbox";
import type { CallOptions, Created } from "./send";

// The wire of the queued account writes and the transfer delete: one call per
// kind, with the client ids the device booked under (contract 1.15.0) and the
// version and balance the write was based on (1.14.0). The answer's own
// version is what an ack adopts: the device never counts the server's.

type Body<T> = T extends (input: infer I, ...rest: never[]) => unknown
	? I
	: never;

/** The sender's "no token": the server answered `undo: null`. */
const NO_UNDO = "";

/** What the entry's payload holds beyond the body: the stored balance the person saw (Update balance, Replace). */
export interface AccountPayload {
	expectedBalance?: string;
}

/** The account's version as the entry holds it (text), or null when it names none. */
export function accountVersionOf(
	entry: Pick<OutboxEntry, "baseVersion">,
): number | null {
	const v = entry.baseVersion;
	if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
	return Number(v);
}

const answer = (undo: string | null, version: number): Created => ({
	undo: undo ?? NO_UNDO,
	version: String(version),
});

/** Whether `entry` is one `dispatchWealth` sends. */
export const isWealthEntry = (
	entry: Pick<OutboxEntry, "entity" | "kind">,
): boolean =>
	entry.entity === "accounts" ||
	(entry.entity === "transfers" && entry.kind === "delete");

/**
 * An account write or a transfer delete. A write to an existing account names
 * the version the entry was based on (a chained entry took its predecessor's
 * answered version); without one it throws before any request, so a write is
 * never sent unchecked.
 */
export async function dispatchWealth(
	api: RetrospendClient,
	entry: OutboxEntry,
	options: CallOptions,
): Promise<Created> {
	const payload = (entry.payload ?? {}) as Record<string, unknown>;
	const id = entry.targetId;
	if (entry.entity === "transfers") {
		const gone = await api.transfers.delete({ id }, options);
		return { undo: gone.undo ?? NO_UNDO };
	}
	if (entry.kind === "create") {
		const made = await api.accounts.create(
			{ ...(payload as Body<typeof api.accounts.create>), id },
			options,
		);
		return answer(made.undo, made.result.version);
	}
	const expectedVersion = accountVersionOf(entry);
	if (expectedVersion === null)
		throw new Error(`An account ${entry.kind} needs the version it read`);
	switch (entry.kind) {
		case "update": {
			const written = await api.accounts.update(
				{
					...(payload as Body<typeof api.accounts.update>),
					id,
					expectedVersion,
				},
				options,
			);
			return answer(written.undo, written.result.version);
		}
		case "close":
		case "reopen": {
			const write =
				entry.kind === "close" ? api.accounts.close : api.accounts.reopen;
			const state = await write({ id, expectedVersion }, options);
			return answer(state.undo, state.result.version);
		}
		case "balance": {
			const done = await api.accounts.updateBalance(
				{
					...(payload as Body<typeof api.accounts.updateBalance>),
					id,
					expectedVersion,
				},
				options,
			);
			return answer(done.undo, done.result.version);
		}
		case "rateType": {
			const done = await api.accounts.setRateType(
				{
					...(payload as Body<typeof api.accounts.setRateType>),
					id,
					expectedVersion,
				},
				options,
			);
			return answer(done.undo, done.result.version);
		}
		default:
			throw new Error(`no ${entry.kind} of accounts`);
	}
}
