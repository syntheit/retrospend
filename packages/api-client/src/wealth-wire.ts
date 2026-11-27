import type { RetrospendClient } from "./index";

// The wire of the queued account writes and the transfer delete: one call per
// kind, with the client ids the device booked under (contract 1.15.0) and the
// version and balance the write was based on (1.14.0). The answer's own
// version is what an ack adopts: the device never counts the server's. Here,
// next to the client, so the phone's sender and the server's tests send the
// same calls.

/** What an outbox entry for these writes holds (the phone's `OutboxEntry` has more). */
export interface WealthEntry {
	entity: string;
	kind: string;
	targetId: string;
	baseVersion: unknown;
	payload: unknown;
}

/** What the call takes beyond the body: the idempotency key and the abort signal. */
export interface WealthCallOptions {
	context: { idempotencyKey: string };
	signal: AbortSignal;
}

/** The undo token ("" when the server answered none) and the version the answer named for the row. */
export interface WealthAnswer {
	undo: string;
	version?: string | null;
	/**
	 * Row ids the entry's booking holds that the server did not write: an edit
	 * (PUT) is answered which of its leg and switch ids it used, and one it did
	 * not use names a row that does not exist. The device drops those rows from
	 * what it holds for the compare.
	 */
	unwritten?: readonly string[];
}

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
	entry: Pick<WealthEntry, "baseVersion">,
): number | null {
	const v = entry.baseVersion;
	if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
	return Number(v);
}

const answer = (undo: string | null, version: number): WealthAnswer => ({
	undo: undo ?? NO_UNDO,
	version: String(version),
});

/** Whether `entry` is one `dispatchWealth` sends. */
export const isWealthEntry = (
	entry: Pick<WealthEntry, "entity" | "kind">,
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
	entry: WealthEntry,
	options: WealthCallOptions,
): Promise<WealthAnswer> {
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
			const unused = [
				["legId", written.result.legId],
				["rateTypeId", written.result.rateTypeId],
			].flatMap(([name, used]) => {
				const sent = payload[name as string];
				return typeof sent === "string" && used === null ? [sent] : [];
			});
			return {
				...answer(written.undo, written.result.version),
				...(unused.length > 0 ? { unwritten: unused } : {}),
			};
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
