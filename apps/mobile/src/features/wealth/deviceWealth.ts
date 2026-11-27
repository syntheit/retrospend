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
	| { settled: "synced" | "queued" | "parked"; clientId: string }
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
	return { settled: sent.status, clientId };
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
				payload: op.body,
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
	return queueCreate(device, "accounts", { kind: "accountCreate", body });
}

/** A new transfer or exchange, booked with its leg and fee ids and queued under its own id. */
export function createTransferOnDevice(
	device: WealthDevice,
	body: Extract<TransferOp, { kind: "transferCreate" }>["body"],
): Promise<WealthAnswer> {
	if (!device.wealthWrites) return Promise.resolve({ settled: "online" });
	return queueCreate(device, "transfers", { kind: "transferCreate", body });
}

/**
 * An edit, close, reopen, balance update or rate type switch of an account,
 * chained after the account's last waiting entry or based on `opened`, the
 * version the screen read (the device's own copy when the screen has none).
 * With neither it is "unreadable": a write sent with no version would
 * overwrite unchecked. The stored balance it names is the device's own copy,
 * as the overlay holds it, so a write over an unsent one names what that one
 * will leave.
 */
export async function writeAccountOnDevice(input: {
	device: WealthDevice;
	op: Exclude<AccountOp, { kind: "accountCreate" }>;
	opened: number | null;
}): Promise<WealthAnswer> {
	const { device, op, opened } = input;
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
			const version = opened ?? booked.accountBase?.version ?? null;
			const base = chainBase(
				gate.earlier,
				version === null ? null : String(version),
			);
			if (!base) return { settled: "unreadable" };
			const expectedBalance =
				NAMES_BALANCE.has(op.kind) && booked.accountBase
					? booked.accountBase.balance
					: undefined;
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
