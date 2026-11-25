import type { RetrospendClient } from "@retrospend/api-client";
import type {
	BookedWrite,
	WriteBody,
	WriteOp,
} from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { deviceWrites } from "@/data/deviceWrites";
import { newClientId } from "@/data/ids";
import type {
	BaseVersion,
	DeviceBooking,
	Outbox,
	OutboxEntry,
} from "@/data/outbox";
import { type FlushOptions, flushOutbox } from "@/data/sync";
import type { PendingWrite } from "./draft";
import {
	createEntrySender,
	entryOutbox,
	notStored,
	SEND_TIMEOUT_MS,
	type SenderOptions,
	type Transport,
	type UndoRef,
	undoFor,
	undoKey,
} from "./send";
import { releaseSent, retainSent } from "./sentRetain";

// Save and Undo for the composers. Every write goes through the outbox first
// (the phone is offline-first), then one flush tries to send it: online it
// ends with the server's undo token, offline it waits in the outbox.
//
// One thing may touch the outbox's entries at a time: a flush (from Save, the
// foreground, the network coming back) or an Undo. Without that, Undo could
// delete an entry whose send is in flight, and the server would keep a write
// the person took back.

const queues = new WeakMap<Outbox, Promise<unknown>>();

/** Runs `task` after everything queued before it on this outbox has ended. */
export function exclusive<T>(
	outbox: Outbox,
	task: () => Promise<T>,
): Promise<T> {
	const before = queues.get(outbox) ?? Promise.resolve();
	const run = before.then(task, task);
	queues.set(
		outbox,
		run.catch(() => undefined),
	);
	return run;
}

/**
 * Takes a waiting entry out of the outbox (a delete, or an edit that will
 * write it again), alone on the outbox so no send of it is in flight. Null
 * when it is gone already: a flush sent it first, and the server has it.
 */
export function takeFromOutbox(
	outbox: Outbox,
	clientId: string,
	/**
	 * Only an entry that never began a send. With the device engine on, an
	 * entry whose answer may be lost cannot be folded into an edit or dropped
	 * by a delete: the server may hold it, and nothing here chains a write to
	 * it until the sender can read the row back.
	 */
	unsentOnly = false,
): Promise<OutboxEntry | null> {
	return exclusive(outbox, async () => {
		const entry = (await outbox.all()).find((e) => e.clientId === clientId);
		if (!entry || (unsentOnly && entry.attempts > 0)) return null;
		await outbox.discard(clientId);
		return entry;
	});
}

/** One flush of the composers' entries, alone on the outbox. */
export function flushEntries(
	outbox: Outbox,
	api: RetrospendClient,
	transport: Transport,
	options?: Omit<SenderOptions, "keepSealed"> & FlushOptions,
) {
	return exclusive(outbox, async () => {
		const mine = entryOutbox(outbox);
		const before = await mine.pending();
		const writes = deviceWrites(api);
		const pullsBegun = options?.pullsBegun ?? writes?.pullsBegun;
		const report = await flushOutbox(
			mine,
			createEntrySender(transport, {
				...options,
				pullsBegun,
				keepSealed: (clientId, bytes) => outbox.seal(clientId, bytes),
			}),
			{ pullsBegun },
		);
		// The engine reads the lists as of the last refresh: it sees the acks of this run.
		await writes?.refresh().catch(() => undefined);
		// What left the outbox was sent: lists hold it until the server's row lands.
		const left = new Set((await outbox.all()).map((e) => e.clientId));
		retainSent(before.filter((e) => !left.has(e.clientId)));
		return report;
	});
}

/** What an outbox entry keeps of a booking: the rows and field names, never the base it read. */
export function deviceOf(booked: BookedWrite): DeviceBooking {
	return {
		bookedAt: booked.bookedAt,
		changes: booked.changes,
		changed: booked.changed,
		...(booked.unbooked ? { unbooked: booked.unbooked } : {}),
	};
}

export type SaveOutcome =
	/** The server has it; the token undoes it (null when it answered without one). */
	| { status: "synced"; undo: UndoRef | null }
	/** Waiting on this phone for a connection. */
	| { status: "queued" }
	/** The server refused it. It stays parked on the phone, never dropped. */
	| { status: "parked"; reason: string };

/** How long Save waits for the send before it lets the outbox carry on alone. */
const SAVE_WAIT_MS = SEND_TIMEOUT_MS + 2000;

export async function saveEntry(input: {
	outbox: Outbox;
	api: RetrospendClient;
	write: PendingWrite;
	/** Test seam: the wait for the send. */
	waitMs?: number;
	/** Where the write goes: `transportFor(api)`. */
	transport: Transport;
}): Promise<SaveOutcome> {
	const { outbox, api, write, transport } = input;
	const clientId = String(write.body.id);
	// Under the dev flag the device books it first, over the writes still waiting.
	const writes = write.entity === "expenses" ? deviceWrites(api) : null;
	const booked = await writes?.book({
		kind: "create",
		body: write.body as unknown as WriteBody,
	});
	await outbox.enqueue({
		clientId,
		entity: write.entity,
		kind: "create",
		targetId: clientId,
		baseVersion: null,
		payload: write.body,
		...(booked ? { device: deviceOf(booked) } : {}),
	});
	await writes?.refresh().catch(() => undefined);
	// The flush may be behind another one; Save does not wait on a slow
	// network, the entry stays in the outbox and goes when its turn comes.
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		flushEntries(outbox, api, transport).catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, input.waitMs ?? SAVE_WAIT_MS);
		}),
	]);
	if (timer) clearTimeout(timer);
	// Whichever flush sent it, the token is kept under the client id.
	const undo = undoFor(clientId);
	if (undo) return { status: "synced", undo };
	const entry = (await outbox.all()).find((e) => e.clientId === clientId);
	// Gone from the outbox with no token: the server had it already.
	if (!entry) return { status: "synced", undo: null };
	return entry.state === "conflict"
		? { status: "parked", reason: entry.lastError ?? "refused" }
		: { status: "queued" };
}

export type UndoResult = "undone" | "failed";

/**
 * Whether no later entry, waiting or acked, is about the same row. A write is
 * undone only while it is the last for its row: an undo under a later write
 * would take back more than the person asked for. An entry the lists no longer
 * hold (a pull retired it) is judged by the row the sender noted: any entry
 * still about that row, or no known row, refuses. Fail closed.
 */
async function isLastForTarget(
	outbox: Outbox,
	clientId: string,
	target: string | undefined,
): Promise<boolean> {
	const { open, acked } = await outbox.snapshot();
	const all = [...open, ...acked];
	const entry = all.find((e) => e.clientId === clientId);
	if (!entry) {
		return target !== undefined && !all.some((e) => e.targetId === target);
	}
	return !all.some(
		(e) => e.targetId === entry.targetId && (e.seq ?? 0) > (entry.seq ?? 0),
	);
}

/**
 * Takes a saved write back, and only after any send of it has ended.
 * - The server has it (a token is kept): the server's undo.
 * - It never left the phone (no send ever began): removed from the outbox.
 * - It may be on the server (a send began and its answer is missing): send it
 *   again with the same key, which replays the first answer and its token,
 *   then undo through the server. Never delete what the server may hold: only
 *   a 400, 403, 404 or 422 on the resend proves it was never stored, and a
 *   422 that says the key holds another request proves nothing.
 * Under the dev flag an undo uses a new key per generation, and is refused
 * (no request) while a later write is about the same row.
 * "failed" means it could not be taken back now (offline); it stays queued.
 */
export function undoSaved(input: {
	outbox: Outbox;
	api: RetrospendClient;
	clientId: string;
	/** Where the write went: `transportFor(api)`. */
	transport: Transport;
}): Promise<UndoResult> {
	const { outbox, api, clientId, transport } = input;
	return exclusive(outbox, async () => {
		const writes = deviceWrites(api);
		try {
			if (
				writes &&
				!(await isLastForTarget(outbox, clientId, undoFor(clientId)?.target))
			)
				return "failed";
			// Raised and stored before the request leaves.
			const generation = () =>
				writes ? outbox.nextUndoGeneration(clientId) : undefined;
			const undoNow = async (token: UndoRef) => {
				await transport.undo(token, undoKey(clientId, await generation()));
				releaseSent(clientId);
				await outbox.undone(clientId);
				await writes?.refresh().catch(() => undefined);
				return "undone" as const;
			};
			const known = undoFor(clientId);
			if (known) return await undoNow(known);
			const entry = (await outbox.all()).find((e) => e.clientId === clientId);
			// Gone with no token: it was sent in an earlier session.
			if (!entry) return "failed";
			if (entry.attempts === 0) {
				await outbox.discard(clientId);
				await writes?.refresh().catch(() => undefined);
				return "undone";
			}
			await outbox.markSending(clientId);
			const sent = await createEntrySender(transport, {
				keepSealed: (id, bytes) => outbox.seal(id, bytes),
			})(entry);
			if (sent.status === "retry") {
				await outbox.markFailed(clientId, sent.reason, sent.kind);
				return "failed";
			}
			if (sent.status === "conflict") {
				// Refused outright: the server never held it, nothing to undo.
				if (notStored(sent)) {
					await outbox.discard(clientId);
					return "undone";
				}
				// Any other answer (a replay it can not give back, a key held by
				// another request, a 5xx) does not say it is not there. Keep it
				// parked, where Couldn't sync shows it.
				await outbox.markConflict(clientId, sent.reason);
				return "failed";
			}
			await outbox.markSent(clientId);
			const token = undoFor(clientId);
			// No token means the server held it already and answered without one.
			if (!token) return "failed";
			return await undoNow(token);
		} catch {
			return "failed";
		}
	});
}

export type QueuedChange =
	| { status: "queued"; clientId: string }
	/** The row's last entry began a send: it may be on the server, and nothing stacks on it yet. */
	| { status: "busy" }
	/** The row's last entry is parked: Couldn't sync resolves it first, and nothing stacks on it. */
	| { status: "parked" }
	/** Neither the screen nor the device's copy has a version of the row: refused, never guessed. */
	| { status: "unreadable" };

/**
 * Queues an edit or a delete of a saved expense, under the dev flag. The
 * device books it over the writes still waiting; the entry is chained after
 * the last waiting entry for the row, or based on `opened`, the `updatedAt`
 * of the row as the screen read it. The screen's version wins; when the screen
 * read none (offline), the booking's `base` stands in, which is the version
 * the device last pulled for the row. With neither it is "unreadable": an
 * entry sent with no `expectedUpdatedAt` would overwrite or delete unchecked.
 * An edit the device could not book is unreadable too: the names of the fields
 * it changed are known only from the booking.
 * A flush sends it; until then Undo takes it back out of the outbox.
 */
export function queueExpenseChange(input: {
	outbox: Outbox;
	writes: DeviceWrites;
	/** The row's `updatedAt` as the screen opened it; null when it was not read. */
	opened: string | null;
	change:
		| { kind: "update"; body: Record<string, unknown> }
		| { kind: "delete"; id: string };
}): Promise<QueuedChange> {
	const { outbox, writes, change, opened } = input;
	const targetId =
		change.kind === "delete" ? change.id : String(change.body.id);
	const op: WriteOp =
		change.kind === "delete"
			? { kind: "delete", id: targetId }
			: { kind: "update", body: change.body as unknown as WriteBody };
	return exclusive(outbox, async () => {
		const forRow = (await outbox.all()).filter((e) => e.targetId === targetId);
		// Any parked entry for the row blocks, not only the last: a parked entry
		// has begun a send too, and waiting never clears it.
		if (forRow.some((e) => e.state === "conflict")) return { status: "parked" };
		const earlier = forRow.at(-1);
		if (earlier && earlier.attempts > 0) return { status: "busy" };
		const booked = await writes.book(op);
		// Which fields this phone changed comes from the booking alone. Without it
		// a later re-base could not tell an edit from no edit: never queued blind.
		if (change.kind === "update" && !booked) return { status: "unreadable" };
		const version = opened ?? booked?.base ?? null;
		if (!earlier && !version) return { status: "unreadable" };
		const base: BaseVersion = earlier
			? { after: earlier.clientId }
			: (version as string);
		const clientId = newClientId();
		await outbox.enqueue({
			clientId,
			entity: "expenses",
			kind: change.kind,
			targetId,
			baseVersion: base,
			payload: change.kind === "delete" ? { id: targetId } : change.body,
			...(booked ? { device: deviceOf(booked) } : {}),
		});
		await writes.refresh().catch(() => undefined);
		return { status: "queued", clientId };
	});
}
