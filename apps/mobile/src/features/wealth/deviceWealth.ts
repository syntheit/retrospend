import type { RetrospendClient } from "@retrospend/api-client";
import type { AccountOp, TransferOp, WriteOp } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { newClientId } from "@/data/ids";
import type { Outbox, OutboxKind } from "@/data/outbox";
import { targetsWithEntries } from "@/data/outbox-chain";
import { transportFor } from "@/data/transport";
import {
	chainBase,
	chainGate,
	deviceOf,
	exclusive,
	flushThenOutcome,
} from "@/features/entry/queue";
import type { UndoRef } from "@/features/entry/send";

// A person's account write or transfer under the dev flag, when the server
// says it takes them (features.wealthWrites): the device books it over the
// writes still waiting, the entry carries the client ids it booked under and
// the version and balance it was based on, and one flush sends it. Offline it
// waits on the phone. Without the flag, or when the device cannot book it (a
// move it cannot see whole, no rows), nothing is queued and the caller writes
// online as before. The device books and never shows its own figure.

/** What a wealth write needs of the engine, the outbox and the server. */
export interface WealthDevice {
	api: RetrospendClient;
	outbox: Outbox;
	writes: DeviceWrites;
	/** `wealthWritesOn`: whether the server takes these writes. */
	wealthWrites: boolean;
}

/** Where a wealth write ended up. Nothing is queued for `online`, `busy`, `blocked` and `unreadable`. */
export type WealthAnswer =
	/** The server has it; the token undoes it (null when it answered without one). */
	| { settled: "synced"; clientId: string; undo: UndoRef | null }
	/** Waiting on this phone for a connection. */
	| { settled: "queued"; clientId: string }
	/** The server refused it: it stays under Couldn't sync. */
	| { settled: "parked"; clientId: string }
	/** Not booked on the device: write it online. */
	| { settled: "online" }
	/** An earlier write to this row began a send: it may be on the server. */
	| { settled: "busy" }
	/** An earlier write to this row is parked: Couldn't sync resolves it first. */
	| { settled: "blocked" }
	/** Neither the screen nor the device has the account's version: never guessed. */
	| { settled: "unreadable" };

/** The entry kind of each account op. */
const KIND: Record<AccountOp["kind"], OutboxKind> = {
	accountCreate: "create",
	accountUpdate: "update",
	accountClose: "close",
	accountReopen: "reopen",
	accountBalance: "balance",
	accountRateType: "rateType",
};

/** The ops that name the stored balance the person saw (the sender's `expectedBalance`). */
const NAMES_BALANCE = new Set<AccountOp["kind"]>([
	"accountUpdate",
	"accountBalance",
]);

async function sendOnce(
	device: WealthDevice,
	clientId: string,
): Promise<WealthAnswer> {
	const sent = await flushThenOutcome({
		outbox: device.outbox,
		api: device.api,
		transport: transportFor(device.api),
		clientId,
	});
	return sent.status === "synced"
		? { settled: "synced", clientId, undo: sent.undo }
		: { settled: sent.status, clientId };
}

/**
 * A create under `body.id`, which is the entry's client id and the account's
 * or transfer's id, so the server's row and the phone's are one.
 */
async function queueCreate(
	device: WealthDevice,
	entity: "accounts" | "transfers",
	op: Extract<
		AccountOp | TransferOp,
		{ kind: "accountCreate" | "transferCreate" }
	>,
	title: string | undefined,
): Promise<WealthAnswer> {
	const { outbox, writes } = device;
	const id = op.body.id;
	const queued = await exclusive(
		outbox,
		async (): Promise<WealthAnswer | null> => {
			if ((await outbox.all()).some((e) => e.clientId === id)) return null;
			const booked = await writes.book(op);
			if (!booked) return { settled: "online" };
			await outbox.enqueue({
				clientId: id,
				entity,
				kind: "create",
				targetId: id,
				baseVersion: null,
				payload: title === undefined ? op.body : { ...op.body, title },
				device: deviceOf(booked),
			});
			await writes.refresh().catch(() => undefined);
			return null;
		},
	);
	return queued ?? sendOnce(device, id);
}

/** A new account, booked and queued under its own id. */
export function createAccountOnDevice(
	device: WealthDevice,
	body: Extract<AccountOp, { kind: "accountCreate" }>["body"],
): Promise<WealthAnswer> {
	if (!device.wealthWrites) return Promise.resolve({ settled: "online" });
	return queueCreate(
		device,
		"accounts",
		{ kind: "accountCreate", body },
		undefined,
	);
}

/**
 * A new transfer or exchange, booked with its leg and fee ids and queued under
 * its own id. `title` is kept for the Sync issues row and never sent.
 */
export function createTransferOnDevice(
	device: WealthDevice,
	body: Extract<TransferOp, { kind: "transferCreate" }>["body"],
	title?: string,
): Promise<WealthAnswer> {
	if (!device.wealthWrites) return Promise.resolve({ settled: "online" });
	return queueCreate(
		device,
		"transfers",
		{ kind: "transferCreate", body },
		title,
	);
}

/**
 * What the screen showed of the account when the person opened the sheet: its
 * version and its stored balance (what it holds, or what is owed on a
 * liability). The write is checked against these, not against the device's
 * copy at Save, so a pull that lands another device's transfer while the
 * sheet is open makes the write park instead of overwriting it.
 */
export interface SeenAccount {
	version: number;
	balance: string;
}

/**
 * An edit, close, reopen, balance update or rate type switch of an account,
 * chained after the account's last waiting entry or based on `opened`, the
 * version the screen read (the device's own copy when the screen has none).
 * With neither it is "unreadable": a write sent with no version would
 * overwrite unchecked. The stored balance it names is the one the screen
 * showed; behind an unsent write it is the overlay's, which names what that
 * write will leave.
 */
export async function writeAccountOnDevice(input: {
	device: WealthDevice;
	op: Exclude<AccountOp, { kind: "accountCreate" }>;
	/** What the screen read; null when it read none (offline with no copy), and the device's own is used. Required, so a sheet cannot forget it. */
	opened: SeenAccount | null;
	/** The account's name, kept for the Sync issues row and never sent. */
	title?: string;
}): Promise<WealthAnswer> {
	const { device, op, opened, title } = input;
	if (!device.wealthWrites) return { settled: "online" };
	const { outbox, writes } = device;
	const id = op.body.id;
	const queued = await exclusive(
		outbox,
		async (): Promise<WealthAnswer | string> => {
			const gate = chainGate(await outbox.all(), id);
			if (gate.status !== "open")
				return { settled: gate.status === "parked" ? "blocked" : "busy" };
			const booked = await writes.book(op);
			if (!booked) return { settled: "online" };
			const version = opened?.version ?? booked.accountBase?.version ?? null;
			const base = chainBase(
				gate.earlier,
				version === null ? null : String(version),
			);
			if (!base) return { settled: "unreadable" };
			// The balance the person saw is what the write names, unless an unsent
			// write ahead of it itself names a balance: then the server will hold
			// what that one leaves, which the overlay has. A write ahead that
			// checks only the version (a rate type switch) leaves the check as seen.
			const aheadNamesBalance = (await outbox.all()).some(
				(e) =>
					e.targetId === id &&
					e.state !== "conflict" &&
					typeof (e.payload as { expectedBalance?: unknown } | null)
						?.expectedBalance === "string",
			);
			const expectedBalance = !NAMES_BALANCE.has(op.kind)
				? undefined
				: aheadNamesBalance
					? booked.accountBase?.balance
					: (opened?.balance ?? booked.accountBase?.balance);
			const clientId = newClientId();
			await outbox.enqueue({
				clientId,
				entity: "accounts",
				kind: KIND[op.kind],
				targetId: id,
				baseVersion: base,
				payload: {
					...op.body,
					...(expectedBalance !== undefined ? { expectedBalance } : {}),
					...(title !== undefined ? { title } : {}),
				},
				device: deviceOf(booked),
			});
			await writes.refresh().catch(() => undefined);
			return clientId;
		},
	);
	return typeof queued === "string" ? sendOnce(device, queued) : queued;
}

/**
 * Whether a write for transfer `id` waits on this phone, is parked, or was
 * sent and no pull has shown back yet. Its delete refuses until then ("Sync
 * first"): a transfer has no version to chain on. Fails closed.
 */
export async function transferHasWrites(
	outbox: Outbox | null,
	id: string,
): Promise<boolean> {
	if (!outbox) return true;
	try {
		const { open, acked } = await outbox.snapshot();
		return targetsWithEntries([...open, ...acked], [id]).length > 0;
	} catch {
		return true;
	}
}

/**
 * Whether a write about account `id` waits on this phone, is parked, or was
 * sent and no pull has shown back yet: an entry for the account, or a
 * transfer queued from or to it. Its delete (which stays online and stashes
 * the account with its transfers) refuses until then ("Sync first"). Fails
 * closed.
 */
export async function accountHasWrites(
	outbox: Outbox | null,
	id: string,
): Promise<boolean> {
	if (!outbox) return true;
	try {
		const { open, acked } = await outbox.snapshot();
		const entries = [...open, ...acked];
		// A transfer is named by its own id: it reaches the account by the ends
		// its body names, or by the account row its booking changed (a delete).
		const touching = entries.some((e) => {
			const body = (e.payload ?? {}) as {
				fromAccountId?: unknown;
				toAccountId?: unknown;
			};
			return (
				body.fromAccountId === id ||
				body.toAccountId === id ||
				(e.device?.changes ?? []).some(
					(c) => c.table === "accounts" && c.id === id,
				)
			);
		});
		return (
			targetsWithEntries(entries, [id], touching ? new Set([id]) : undefined)
				.length > 0
		);
	} catch {
		return true;
	}
}

/** A transfer's delete, booked and queued; refused while another write names the transfer. */
export async function deleteTransferOnDevice(
	device: WealthDevice,
	id: string,
): Promise<WealthAnswer> {
	if (!device.wealthWrites) return { settled: "online" };
	const { outbox, writes } = device;
	const queued = await exclusive(
		outbox,
		async (): Promise<WealthAnswer | string> => {
			if (await transferHasWrites(outbox, id)) return { settled: "busy" };
			const op: WriteOp = { kind: "transferDelete", body: { id } };
			const booked = await writes.book(op);
			if (!booked) return { settled: "online" };
			const clientId = newClientId();
			await outbox.enqueue({
				clientId,
				entity: "transfers",
				kind: "delete",
				targetId: id,
				baseVersion: null,
				payload: { id },
				device: deviceOf(booked),
			});
			await writes.refresh().catch(() => undefined);
			return clientId;
		},
	);
	return typeof queued === "string" ? sendOnce(device, queued) : queued;
}
