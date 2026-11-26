import type { RetrospendClient } from "@retrospend/api-client";
import { newClientId } from "@/data/ids";
import type { Outbox } from "@/data/outbox";
import { targetsWithEntries } from "@/data/outbox-chain";
import { transportFor } from "@/data/transport";
import {
	chainBase,
	chainGate,
	deviceOf,
	exclusive,
	flushThenOutcome,
	undoSaved,
} from "@/features/entry/queue";
import { type SettleDevice, withTimeout } from "./deviceSettle";

// A person's template create, edit and pause under the dev flag: the device
// books it and previews it (held against the server's dry run, never shown),
// the write waits in the outbox, and one flush sends it. Offline it stays on
// the phone; Undo takes it back out, or through the server once it was sent.
// With the flag off none of this runs and the sheets write to API v1 as ever.
// Delete stays online (`templateHasWrites`).

type Recurring = RetrospendClient["recurring"];

/** A new template: the body of POST /recurring without its id, which the entry's client id is. */
export type TemplateCreate = Omit<Parameters<Recurring["create"]>[0], "id">;

/** The fields an edit names, as PATCH /recurring/{id} takes them. */
export type TemplatePatch = Omit<
	Parameters<Recurring["update"]>[0],
	"id" | "expectedUpdatedAt"
>;

/** Where a template write ended up. Nothing is queued for `busy`, `blocked` and `unreadable`. */
export type TemplateAnswer =
	/** The server has it. */
	| { settled: "synced"; clientId: string }
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

/** Only the template's id is read by the compare: the booking is thrown away. */
const PREVIEW_TEMPLATE_ID = "preview";

/**
 * The server's dry run of a create, which the sheet shows, with the device's
 * own preview held against it (nothing is shown from it and it never waits).
 * Offline this throws, and the sheet lets Add queue without a dry run.
 */
export function previewTemplate(device: SettleDevice, body: TemplateCreate) {
	return withTimeout(async (options) => {
		const diff = await device.api.recurring.previewCreate(body, options);
		void device.writes
			.comparePreview(
				{
					kind: "templateCreate",
					body: { ...body, id: PREVIEW_TEMPLATE_ID },
				},
				diff,
			)
			.catch(() => undefined);
		return diff;
	});
}

/** Flushes once and says where entry `clientId` ended up. */
async function sendOnce(
	device: SettleDevice,
	clientId: string,
): Promise<TemplateAnswer> {
	const sent = await flushThenOutcome({
		outbox: device.outbox,
		api: device.api,
		transport: transportFor(device.api),
		clientId,
	});
	return { settled: sent.status, clientId };
}

/**
 * A new template, booked on the device and queued under `id`: the entry's
 * client id is its idempotency key and the template's id, so the server's row
 * and the phone's are one, and a retry of the same write finds it queued.
 */
export async function createTemplateOnDevice(input: {
	device: SettleDevice;
	id: string;
	body: TemplateCreate;
}): Promise<TemplateAnswer> {
	const { device, id, body } = input;
	const { outbox, writes } = device;
	await exclusive(outbox, async () => {
		if ((await outbox.all()).some((e) => e.clientId === id)) return;
		const booked = await writes.book({
			kind: "templateCreate",
			body: { ...body, id },
		});
		await outbox.enqueue({
			clientId: id,
			entity: "recurring",
			kind: "create",
			targetId: id,
			baseVersion: null,
			payload: body,
			...(booked ? { device: deviceOf(booked) } : {}),
		});
		await writes.refresh().catch(() => undefined);
	});
	return sendOnce(device, id);
}

/**
 * An edit of the fields `patch` names (pause and auto-pay included), chained
 * after the template's last waiting entry or based on `opened`, the version
 * the screen read (the device's own copy when the screen has none). With
 * neither it is "unreadable": an edit sent with no stamp would overwrite
 * unchecked. `title` is kept for the Sync issues row and never sent.
 */
export async function editTemplateOnDevice(input: {
	device: SettleDevice;
	id: string;
	patch: TemplatePatch;
	opened: string | null;
	title: string;
}): Promise<TemplateAnswer> {
	const { device, id, patch, opened, title } = input;
	const { outbox, writes } = device;
	const queued = await exclusive(
		outbox,
		async (): Promise<TemplateAnswer | string> => {
			const gate = chainGate(await outbox.all(), id);
			if (gate.status !== "open")
				return { settled: gate.status === "parked" ? "blocked" : "busy" };
			const booked = await writes.book({
				kind: "templateUpdate",
				body: { id, ...patch },
			});
			const base = chainBase(gate.earlier, opened ?? booked?.base ?? null);
			if (!base) return { settled: "unreadable" };
			const clientId = newClientId();
			await outbox.enqueue({
				clientId,
				entity: "recurring",
				kind: "update",
				targetId: id,
				baseVersion: base,
				payload: { ...patch, title },
				...(booked ? { device: deviceOf(booked) } : {}),
			});
			await writes.refresh().catch(() => undefined);
			return clientId;
		},
	);
	return typeof queued === "string" ? sendOnce(device, queued) : queued;
}

/**
 * Whether a write to template `id` waits on this phone, is parked, or was sent
 * and no pull has shown back yet. Delete stays online (the server clears the
 * envelope targets and signs its own undo), so it refuses until that is
 * settled ("Sync first"). Fails closed: no outbox, or one that cannot be
 * read, counts as a write waiting.
 */
export async function templateHasWrites(
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

/** Takes a new template back: out of the outbox while it waits, or through the server's delete once it was sent. */
export async function undoTemplateCreate(
	device: SettleDevice,
	clientId: string,
): Promise<void> {
	const result = await undoSaved({
		outbox: device.outbox,
		api: device.api,
		transport: transportFor(device.api),
		clientId,
	});
	if (result !== "undone") throw new Error("Could not undo the new template");
}

/** The edit's send began and no answer is known: it may be on the server, so it is neither taken out nor written back over. */
export class EditStillSending extends Error {}

/**
 * Takes an edit back, by what the outbox says happened to it (not by what the
 * sheet was told, which a slow send makes stale):
 * - never sent, or parked (the server refused it): taken out of the outbox;
 * - sent with no answer yet: refused (`EditStillSending`), and nothing is sent;
 * - left the outbox, so the server took it: the old values written over the
 *   template as it is now (the server has no undo for an edit).
 */
export async function undoTemplateEdit(input: {
	device: SettleDevice;
	clientId: string;
	id: string;
	back: TemplatePatch;
	title: string;
}): Promise<void> {
	const { device, clientId, id, back, title } = input;
	const { outbox, writes } = device;
	const found = await exclusive(outbox, async () => {
		const entry = (await outbox.all()).find((e) => e.clientId === clientId);
		if (!entry) return "left";
		if (entry.attempts > 0 && entry.state !== "conflict") return "unknown";
		await outbox.discard(clientId);
		await writes.refresh().catch(() => undefined);
		return "taken";
	});
	if (found === "taken") return;
	if (found === "unknown") throw new EditStillSending();
	const out = await editTemplateOnDevice({
		device,
		id,
		patch: back,
		opened: null,
		title,
	});
	if (out.settled !== "synced" && out.settled !== "queued")
		throw new Error("Could not write the old values back");
}
