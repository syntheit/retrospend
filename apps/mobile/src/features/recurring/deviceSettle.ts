import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import type { Outbox } from "@/data/outbox";
import { transportFor } from "@/data/transport";
import {
	deviceOf,
	exclusive,
	flushThenOutcome,
	type QueuedChange,
} from "@/features/entry/queue";
import {
	type RecurringPayload,
	SEND_TIMEOUT_MS,
	type UndoRef,
} from "@/features/entry/send";
import {
	type SettleInput,
	type SettleKind,
	settleOpOf,
} from "@/features/entry/settleOp";
import type { RecurringItem } from "./source";

// A person's confirm or skip of a recurring expense under the dev flag: the
// device books it and previews it (held against the server's dry run, never
// shown), the write waits in the outbox with the template's version as its
// stamp, and one flush sends it. Offline it stays on the phone; Undo takes it
// back out, or through the server once it was sent. With the flag off none of
// this runs: `useSettleDevice` is null and the sheets write to API v1 as ever.

/** What a settle needs of the engine, the outbox and the server. */
export interface SettleDevice {
	api: RetrospendClient;
	outbox: Outbox;
	writes: DeviceWrites;
}

/** Only the preview compare reads this id: the booking is thrown away. */
const PREVIEW_EXPENSE_ID = "preview";

/**
 * The server's dry run, which the sheet shows, with the device's own preview
 * held against it (nothing is shown from it and it never waits). Offline this
 * throws, and the sheet lets Save queue without a dry run.
 */
export async function previewSettle(
	device: SettleDevice,
	kind: SettleKind,
	input: SettleInput,
) {
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(), SEND_TIMEOUT_MS);
	const options = { signal: timeout.signal };
	try {
		const { recurring } = device.api;
		const diff =
			kind === "skip"
				? await recurring.previewSkip(input, options)
				: await recurring.previewConfirm(input, options);
		void device.writes
			.comparePreview(settleOpOf(kind, input, PREVIEW_EXPENSE_ID), diff)
			.catch(() => undefined);
		return diff;
	} finally {
		clearTimeout(timer);
	}
}

/** Where a settle ended up. Nothing is queued for `busy`, `blocked` and `unreadable`. */
export type SettleAnswer =
	/** The server has it; the token undoes it (null when it answered without one). */
	| { settled: "synced"; clientId: string; undo: UndoRef | null }
	/** Waiting on this phone for a connection. */
	| { settled: "queued"; clientId: string }
	/** The server refused it: it stays under Couldn't sync. */
	| { settled: "parked"; clientId: string }
	/** An earlier write to this template began a send: it may be on the server. */
	| { settled: "busy" }
	/** An earlier write to this template is parked: Couldn't sync resolves it first. */
	| { settled: "blocked" }
	/** Neither the screen nor the device has a version of the template: never guessed. */
	| { settled: "unreadable" };

export const isSettled = (out: object): out is SettleAnswer => "settled" in out;

/**
 * Queues one settle, chained after the template's last waiting entry or based
 * on the version the screen read (the device's pulled one when the screen has
 * none). The entry's client id is its idempotency key and the posted expense's
 * id; a retry of the same write finds it already queued.
 */
function queueSettle(input: {
	device: SettleDevice;
	kind: SettleKind;
	body: SettleInput;
	clientId: string;
	opened: string | null;
	title: string;
	currency: string;
}): Promise<QueuedChange> {
	const { device, kind, body, clientId, opened, title, currency } = input;
	const { outbox, writes } = device;
	return exclusive(outbox, async () => {
		const all = await outbox.all();
		if (all.some((e) => e.clientId === clientId))
			return { status: "queued", clientId };
		const forRow = all.filter((e) => e.targetId === body.id);
		if (forRow.some((e) => e.state === "conflict")) return { status: "parked" };
		const earlier = forRow.at(-1);
		if (earlier && earlier.attempts > 0) return { status: "busy" };
		const booked = await writes.book(settleOpOf(kind, body, clientId));
		const version = opened ?? booked?.base ?? null;
		if (!earlier && !version) return { status: "unreadable" };
		const payload: RecurringPayload = {
			dueAt: body.dueAt,
			title,
			currency,
			...(body.amount !== undefined ? { amount: body.amount } : {}),
			...(body.paidOn !== undefined ? { paidOn: body.paidOn } : {}),
		};
		await outbox.enqueue({
			clientId,
			entity: "recurring",
			kind,
			targetId: body.id,
			baseVersion: earlier ? { after: earlier.clientId } : (version as string),
			payload,
			...(booked ? { device: deviceOf(booked) } : {}),
		});
		await writes.refresh().catch(() => undefined);
		return { status: "queued", clientId };
	});
}

/** The save: books it on the device, queues it, and sends it once (the flush answers `queued` offline). */
export async function settleOnDevice(input: {
	device: SettleDevice;
	kind: SettleKind;
	body: SettleInput;
	/** The sheet's key for this body: the entry's client id. */
	clientId: string;
	item: RecurringItem;
}): Promise<SettleAnswer> {
	const { device, kind, body, clientId, item } = input;
	const queued = await queueSettle({
		device,
		kind,
		body,
		clientId,
		opened: item.updatedAt,
		title: item.title,
		currency: item.amount.currency,
	});
	if (queued.status !== "queued")
		return {
			settled:
				queued.status === "busy"
					? "busy"
					: queued.status === "parked"
						? "blocked"
						: "unreadable",
		};
	const sent = await flushThenOutcome({
		outbox: device.outbox,
		api: device.api,
		transport: transportFor(device.api),
		clientId,
	});
	if (sent.status === "synced")
		return { settled: "synced", clientId, undo: sent.undo };
	return { settled: sent.status === "queued" ? "queued" : "parked", clientId };
}
