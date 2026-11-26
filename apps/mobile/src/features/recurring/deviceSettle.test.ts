import type { RetrospendClient } from "@retrospend/api-client";
import type { BookedWrite } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { confirm, confirmBooking } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { forgetNotFound, forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import {
	previewSettle,
	type SettleDevice,
	settleOnDevice,
} from "./deviceSettle";
import type { RecurringItem } from "./source";

// A person's confirm or skip under the dev flag: booked on the device, queued
// with the template's version as its stamp, sent once, and kept on the phone
// when the server cannot be reached. The item is a USD 15.99 template due
// 2026-11-01T12:00Z, read at version STAMP.

const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));

const STAMP = "2026-11-18T10:00:00.000Z";
const NEXT = "2026-11-20T10:00:00.000Z";
const DUE = "2026-11-01T12:00:00.000Z";
const CID = "11111111-1111-4111-8111-111111111111";

const item = {
	id: "t1",
	title: "Netflix",
	direction: "out",
	amount: { minor: 1599, currency: "USD" },
	updatedAt: STAMP,
	dueAt: DUE,
} as unknown as RecurringItem;

const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });
const network = () => new Error("Network request failed");

const bookedOf = (): BookedWrite => {
	const booked = confirmBooking(CID, "t1");
	return {
		...booked,
		changes: [...booked.changes],
		changed: [...booked.changed],
		base: STAMP,
	};
};

function setup(book: () => BookedWrite | null = bookedOf) {
	const writes = {
		book: jest.fn(async () => book()),
		comparePreview: jest.fn(async () => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
	} as unknown as jest.Mocked<DeviceWrites>;
	mockWrites.mockReturnValue(writes);
	const recurring = {
		confirm: jest.fn(async (_input: unknown, _options: unknown) => ({
			undo: "tok-c",
			confirmed: { templateUpdatedAt: NEXT },
		})),
		skip: jest.fn(async (_input: unknown, _options: unknown) => ({
			undo: "tok-s",
			skipped: { templateUpdatedAt: NEXT },
		})),
		previewConfirm: jest.fn(async (_input: unknown, _options: unknown) => ({
			changes: [],
			unchanged: [],
			unavailable: [],
		})),
		previewSkip: jest.fn(async (_input: unknown, _options: unknown) => ({
			changes: [],
			unchanged: [],
			unavailable: [],
		})),
	};
	const api = { recurring } as never as RetrospendClient;
	const outbox = createOutbox(createMemoryStore(), "scope");
	const device: SettleDevice = { api, outbox, writes };
	return { writes, recurring, outbox, device };
}

const body = { id: "t1", dueAt: DUE };

beforeEach(() => {
	mockWrites.mockReset().mockReturnValue(null);
	forgetUndoTokens();
	forgetSent();
	forgetNotFound(CID);
});

describe("a confirm on the device", () => {
	it("books the op over the sheet's body, then sends it under its own id, due date and stamp", async () => {
		const { device, writes, recurring, outbox } = setup();
		const input = { ...body, amount: "18.50", paidOn: "2026-11-02" };
		const answer = await settleOnDevice({
			device,
			kind: "confirm",
			body: input,
			clientId: CID,
			item,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "confirm",
			body: {
				templateId: "t1",
				dueAt: DUE,
				expenseId: CID,
				amount: "18.50",
				paidOn: "2026-11-02",
			},
		});
		expect(recurring.confirm).toHaveBeenCalledTimes(1);
		const [sent, options] = recurring.confirm.mock.calls[0] ?? [];
		expect(sent).toEqual({
			id: "t1",
			dueAt: DUE,
			expectedUpdatedAt: STAMP,
			expenseId: CID,
			amount: "18.50",
			paidOn: "2026-11-02",
		});
		expect(options).toMatchObject({ context: { idempotencyKey: CID } });
		expect(answer).toEqual({
			settled: "synced",
			clientId: CID,
			undo: {
				entity: "recurring",
				token: "tok-c",
				target: "t1",
				kind: "confirm",
			},
		});
		// The server has it; the device's booking waits for the pull that brings its rows.
		expect(await outbox.all()).toEqual([]);
		const { acked } = await outbox.snapshot();
		expect(acked[0]).toMatchObject({
			clientId: CID,
			kind: "confirm",
			baseVersion: STAMP,
			ack: { version: NEXT },
		});
	});

	it("keeps it on the phone when the server cannot be reached: one entry with its id, due date and stamp", async () => {
		const { device, recurring, outbox } = setup();
		recurring.confirm.mockRejectedValue(network());
		const answer = await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item,
		});
		expect(answer).toEqual({ settled: "queued", clientId: CID });
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			clientId: CID,
			entity: "recurring",
			kind: "confirm",
			targetId: "t1",
			baseVersion: STAMP,
			payload: { dueAt: DUE, title: "Netflix", currency: "USD" },
			state: "failed",
		});
		// A person's write, never the poster's.
		expect(entries[0]?.origin).toBeUndefined();
		// The device's booking travels with it, without a name.
		expect(entries[0]?.device?.changes.map((c) => c.table)).toEqual([
			"expenses",
			"recurringTemplates",
		]);
		expect(JSON.stringify(entries[0]?.device)).not.toContain("Netflix");
	});

	it("a retry of the same body finds it queued: no second entry, and it is not its own earlier write that is busy", async () => {
		const { device, recurring, outbox, writes } = setup();
		recurring.confirm.mockRejectedValue(network());
		const again = () =>
			settleOnDevice({ device, kind: "confirm", body, clientId: CID, item });
		expect(await again()).toEqual({ settled: "queued", clientId: CID });
		// The first send began and got no answer: attempts is 1 now.
		expect(await again()).toEqual({ settled: "queued", clientId: CID });
		expect(await outbox.all()).toHaveLength(1);
		expect(writes.book).toHaveBeenCalledTimes(1);
	});

	it("is parked, not lost, when the server refuses it", async () => {
		const { device, recurring, outbox } = setup();
		recurring.confirm.mockRejectedValue(problem(409, "recurring_changed"));
		const answer = await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item,
		});
		expect(answer).toEqual({ settled: "parked", clientId: CID });
		expect((await outbox.all())[0]).toMatchObject({
			state: "conflict",
			lastError: "recurring_changed",
		});
	});

	it("queues with no device booking when the device cannot book it, based on the screen's version", async () => {
		const { device, outbox, recurring } = setup(() => null);
		recurring.confirm.mockRejectedValue(network());
		await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item,
		});
		const [entry] = await outbox.all();
		expect(entry?.baseVersion).toBe(STAMP);
		expect(entry?.device).toBeUndefined();
	});
});

describe("a skip on the device", () => {
	it("books and sends the skip with the due date and the stamp, and names no expense", async () => {
		const { device, writes, recurring } = setup(() => ({
			bookedAt: 1,
			changes: [],
			changed: [],
			base: STAMP,
		}));
		const answer = await settleOnDevice({
			device,
			kind: "skip",
			body,
			clientId: CID,
			item,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "skip",
			body: { templateId: "t1", dueAt: DUE },
		});
		expect(recurring.skip.mock.calls[0]?.[0]).toEqual({
			id: "t1",
			dueAt: DUE,
			expectedUpdatedAt: STAMP,
		});
		expect(recurring.confirm).not.toHaveBeenCalled();
		expect(answer).toMatchObject({
			settled: "synced",
			undo: { entity: "recurring", token: "tok-s", kind: "skip" },
		});
	});
});

describe("a write that meets an earlier one for the same template", () => {
	it("chains behind a waiting entry and is not sent before it", async () => {
		const { device, recurring, outbox } = setup();
		await outbox.enqueue(confirm("c0", "t1", STAMP));
		recurring.confirm.mockRejectedValue(network());
		await settleOnDevice({
			device,
			kind: "skip",
			body,
			clientId: CID,
			item,
		});
		const entries = await outbox.all();
		expect(entries.map((e) => e.clientId)).toEqual(["c0", CID]);
		expect(entries[1]?.baseVersion).toEqual({ after: "c0" });
		expect(recurring.skip).not.toHaveBeenCalled();
	});

	it("is busy, queues nothing and books nothing, while an earlier one may be on the server", async () => {
		const { device, writes, outbox } = setup();
		await outbox.enqueue(confirm("c0", "t1", STAMP));
		await outbox.markSending("c0");
		const answer = await settleOnDevice({
			device,
			kind: "skip",
			body,
			clientId: CID,
			item,
		});
		expect(answer).toEqual({ settled: "busy" });
		expect(await outbox.all()).toHaveLength(1);
		expect(writes.book).not.toHaveBeenCalled();
	});

	it("is blocked behind a parked one, which Couldn't sync resolves first", async () => {
		const { device, writes, outbox } = setup();
		await outbox.enqueue(confirm("c0", "t1", STAMP));
		await outbox.markConflict("c0", "recurring_changed");
		const answer = await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item,
		});
		expect(answer).toEqual({ settled: "blocked" });
		expect(writes.book).not.toHaveBeenCalled();
	});

	it("is unreadable, never guessed, with no version from the screen or the device", async () => {
		const { device, outbox } = setup(() => null);
		const answer = await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item: { ...item, updatedAt: undefined } as unknown as RecurringItem,
		});
		expect(answer).toEqual({ settled: "unreadable" });
		expect(await outbox.all()).toEqual([]);
	});

	it("stands in the device's pulled version when the screen read none", async () => {
		const { device, outbox, recurring } = setup(() => ({
			...bookedOf(),
			base: "2026-11-17T09:00:00.000Z",
		}));
		recurring.confirm.mockRejectedValue(network());
		await settleOnDevice({
			device,
			kind: "confirm",
			body,
			clientId: CID,
			item: { ...item, updatedAt: undefined } as unknown as RecurringItem,
		});
		expect((await outbox.all())[0]?.baseVersion).toBe(
			"2026-11-17T09:00:00.000Z",
		);
	});
});

describe("the dry run", () => {
	it("shows the server's and holds the device's preview of the same op against it", async () => {
		const { device, writes, recurring } = setup();
		const diff = await previewSettle(device, "confirm", {
			...body,
			amount: "18.50",
		});
		expect(recurring.previewConfirm.mock.calls[0]?.[0]).toEqual({
			...body,
			amount: "18.50",
		});
		expect(diff).toEqual({ changes: [], unchanged: [], unavailable: [] });
		expect(writes.comparePreview).toHaveBeenCalledWith(
			{
				kind: "confirm",
				body: {
					templateId: "t1",
					dueAt: DUE,
					expenseId: "preview",
					amount: "18.50",
				},
			},
			diff,
		);
		await previewSettle(device, "skip", body);
		expect(writes.comparePreview).toHaveBeenLastCalledWith(
			{ kind: "skip", body: { templateId: "t1", dueAt: DUE } },
			diff,
		);
	});

	it("offline throws and compares nothing: the sheet queues without a dry run", async () => {
		const { device, writes, recurring } = setup();
		recurring.previewConfirm.mockRejectedValue(network());
		await expect(previewSettle(device, "confirm", body)).rejects.toThrow();
		expect(writes.comparePreview).not.toHaveBeenCalled();
	});
});
