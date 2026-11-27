import type { RetrospendClient } from "@retrospend/api-client";
import type { BookedWrite } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushEntries, undoSaved } from "@/features/entry/queue";
import { apiTransport, forgetUndoTokens } from "@/features/entry/send";
import {
	createAccountOnDevice,
	createTransferOnDevice,
	deleteTransferOnDevice,
	type WealthDevice,
	writeAccountOnDevice,
} from "./deviceWealth";
import {
	accountOffer,
	commitAccountRebase,
	planAccountRebase,
} from "./rebaseAccount";

// A person's account write and transfer under the dev flag: booked on the
// device, queued with the version it was based on and the stored balance it
// saw, sent once, and kept on the phone while the server cannot be reached.
// Without the flag nothing is booked or queued: the caller writes online.

const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));
let mockNextId = 0;
jest.mock("@/data/ids", () => ({
	newClientId: () =>
		`00000000-0000-4000-8000-${String(++mockNextId).padStart(12, "0")}`,
}));

const A = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const network = () => new Error("Network request failed");
const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

const booked = (over: Partial<BookedWrite> = {}): BookedWrite => ({
	bookedAt: 1,
	changes: [],
	changed: [],
	base: null,
	accountBase: { version: 4, balance: "1000" },
	...over,
});

function deviceWith(
	api: Record<string, unknown>,
	book: DeviceWrites["book"],
	wealthWrites = true,
) {
	const outbox = createOutbox(createMemoryStore(), "scope");
	const writes = {
		book,
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
	} as unknown as DeviceWrites & { refresh: jest.Mock };
	mockWrites.mockReturnValue(writes);
	const device: WealthDevice = {
		api: api as never as RetrospendClient,
		outbox,
		writes,
		wealthWrites,
	};
	return { device, outbox, writes };
}

/** What the sheet showed when it opened: the version and the stored balance. */
const seen = (version: number, balance = "1000") => ({ version, balance });

const balanceOp = {
	kind: "accountBalance" as const,
	body: { id: A, balance: "1200", legId: "l1", rateTypeId: "r1" },
};

beforeEach(() => {
	forgetUndoTokens();
	mockWrites.mockReset();
	mockNextId = 0;
});

describe("without the server's flag", () => {
	it("books nothing and queues nothing: every write is online", async () => {
		const book = jest.fn(async () => booked());
		const { device, outbox } = deviceWith({}, book, false);
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toEqual({ settled: "online" });
		expect(
			await createAccountOnDevice(device, {
				id: A,
				name: "Cash",
				type: "CASH",
				currency: "ARS",
				balance: "5",
			} as never),
		).toEqual({ settled: "online" });
		expect(await createTransferOnDevice(device, { id: A } as never)).toEqual({
			settled: "online",
		});
		expect(await deleteTransferOnDevice(device, A)).toEqual({
			settled: "online",
		});
		expect(book).not.toHaveBeenCalled();
		expect(await outbox.all()).toEqual([]);
	});
});

describe("an account write under the flag", () => {
	it("books, queues with the version and stored balance the screen showed, and sends it", async () => {
		const updateBalance = jest.fn(async () => ({
			undo: "tok",
			result: { version: 7 },
		}));
		const { device, outbox, writes } = deviceWith(
			{ accounts: { updateBalance } },
			async () => booked(),
		);
		const out = await writeAccountOnDevice({
			device,
			op: balanceOp,
			opened: seen(5, "900"),
		});
		expect(out).toMatchObject({ settled: "synced" });
		expect(updateBalance).toHaveBeenCalledWith(
			{
				...balanceOp.body,
				// What the sheet showed, not what the device holds at Save (1,000).
				expectedBalance: "900",
				expectedVersion: 5,
			},
			expect.anything(),
		);
		// Sent: the entry left the outbox for the acked list, with the answered version.
		expect(await outbox.all()).toEqual([]);
		const [acked] = await outbox.acked();
		expect(acked?.ack.version).toBe("7");
		expect(writes.refresh).toHaveBeenCalled();
	});

	it("a PUT the server answered without the leg the device booked leaves that leg out of the acked entry", async () => {
		const update = jest.fn(async () => ({
			undo: "tok",
			result: { version: 6, legId: null, rateTypeId: null },
		}));
		const { device, outbox } = deviceWith({ accounts: { update } }, async () =>
			booked({
				changes: [
					{ table: "legs", id: "l1", before: null, after: {} as never },
					{ table: "accounts", id: A, before: null, after: {} as never },
				],
			}),
		);
		const op = {
			kind: "accountUpdate" as const,
			body: {
				id: A,
				name: "Wise",
				type: "CASH",
				currency: "USD",
				balance: "1000",
				isLiquid: true,
				legId: "l1",
				rateTypeId: "r1",
			},
		};
		await writeAccountOnDevice({ device, op: op as never, opened: seen(4) });
		const [acked] = await outbox.acked();
		expect(acked?.device?.changes.map((c) => c.id)).toEqual([A]);
	});

	it("takes the device's own version when the screen read none", async () => {
		const close = jest.fn(async () => ({ undo: null, result: { version: 5 } }));
		const { device } = deviceWith({ accounts: { close } }, async () =>
			booked(),
		);
		await writeAccountOnDevice({
			device,
			op: { kind: "accountClose", body: { id: A } },
			opened: null,
		});
		expect(close).toHaveBeenCalledWith(
			{ id: A, expectedVersion: 4 },
			expect.anything(),
		);
	});

	it("is unreadable with no version from the screen or the booking, and nothing is queued", async () => {
		const { device, outbox } = deviceWith({}, async () =>
			booked({ accountBase: undefined }),
		);
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: null }),
		).toEqual({ settled: "unreadable" });
		expect(await outbox.all()).toEqual([]);
	});

	it("is online when the device could not book it", async () => {
		const { device, outbox } = deviceWith({}, async () => null);
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toEqual({ settled: "online" });
		expect(await outbox.all()).toEqual([]);
	});

	it("waits in the outbox offline, and the next write to the account chains behind it", async () => {
		const updateBalance = jest.fn(async () => {
			throw network();
		});
		const { device, outbox } = deviceWith(
			{ accounts: { updateBalance } },
			async () => booked(),
		);
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toMatchObject({ settled: "queued" });
		// The send began and no answer is known: it may be on the server, so nothing stacks on it.
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toEqual({ settled: "busy" });
		expect(await outbox.all()).toHaveLength(1);
	});

	it("offline then online: the queued write is sent by the next flush with its version, and its ack keeps the answered version", async () => {
		let online = false;
		const updateBalance = jest.fn(async () => {
			if (!online) throw network();
			return { undo: "tok", result: { version: 8 } };
		});
		const api = { accounts: { updateBalance } };
		const { device, outbox } = deviceWith(api, async () => booked());
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toMatchObject({ settled: "queued" });
		online = true;
		await outbox.requeue((await outbox.all())[0]?.clientId as string);
		await flushEntries(outbox, device.api, apiTransport(device.api));
		expect(await outbox.all()).toEqual([]);
		expect((await outbox.acked())[0]?.ack.version).toBe("8");
		expect(updateBalance).toHaveBeenLastCalledWith(
			expect.objectContaining({ expectedVersion: 4, expectedBalance: "1000" }),
			expect.anything(),
		);
	});

	it("queues a second write behind an unsent one, based on its entry, and sends both in order with the answered version", async () => {
		const close = jest.fn(async () => ({ undo: null, result: { version: 9 } }));
		const reopen = jest.fn(async () => ({
			undo: null,
			result: { version: 10 },
		}));
		const { device, outbox } = deviceWith(
			{ accounts: { close, reopen } },
			async () => booked(),
		);
		// An unsent first entry (never began a send): enqueued directly.
		await outbox.enqueue({
			clientId: "first",
			entity: "accounts",
			kind: "close",
			targetId: A,
			baseVersion: "4",
			payload: { id: A },
		});
		const out = await writeAccountOnDevice({
			device,
			op: { kind: "accountReopen", body: { id: A } },
			opened: seen(4),
		});
		expect(out).toMatchObject({ settled: "synced" });
		expect(close).toHaveBeenCalledWith(
			{ id: A, expectedVersion: 4 },
			expect.anything(),
		);
		// The device's own count (5) is never sent: the first answer's 9 is.
		expect(reopen).toHaveBeenCalledWith(
			{ id: A, expectedVersion: 9 },
			expect.anything(),
		);
	});

	it("parks a stale version as account_changed", async () => {
		const updateBalance = jest.fn(async () => {
			throw problem(409, "account_changed");
		});
		const { device, outbox } = deviceWith(
			{ accounts: { updateBalance } },
			async () => booked(),
		);
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(3) }),
		).toMatchObject({ settled: "parked" });
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({
			state: "conflict",
			lastError: "account_changed",
		});
	});

	it("a stale version parks, and Try again re-bases it on the pulled account and succeeds", async () => {
		let pulledVersion = 4;
		const updateBalance = jest.fn(async (body: { expectedVersion: number }) => {
			if (body.expectedVersion !== 6) throw problem(409, "account_changed");
			return { undo: "tok", result: { version: 7 } };
		});
		const { device, outbox, writes } = deviceWith(
			{ accounts: { updateBalance } },
			async () => booked(),
		);
		Object.assign(writes, {
			storedAccount: async () => ({
				version: pulledVersion,
				balance: "1100",
				closed: false,
			}),
		});
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(4) }),
		).toMatchObject({ settled: "parked" });
		// Another device's change reaches the phone: the account is at version 6.
		pulledVersion = 6;
		const clientId = (await outbox.all())[0]?.clientId as string;
		const plan = await planAccountRebase({ outbox, writes, clientId });
		if (!plan) throw new Error("no plan");
		await commitAccountRebase({ outbox, writes, clientId, plan });
		await flushEntries(outbox, device.api, apiTransport(device.api));
		expect(updateBalance).toHaveBeenLastCalledWith(
			expect.objectContaining({ expectedVersion: 6, expectedBalance: "1100" }),
			expect.anything(),
		);
		expect(await outbox.all()).toEqual([]);
		expect((await outbox.acked())[0]?.ack.version).toBe("7");
	});

	it("parks when a transfer landed while the sheet was open, and Try again previews against the account as pulled", async () => {
		// The sheet showed 1,000. A +200 transfer reached the device, so the
		// overlay holds 1,200 at Save; the server holds 1,200 too.
		const updateBalance = jest.fn(async (body: { expectedBalance: string }) => {
			if (body.expectedBalance !== "1200")
				throw problem(409, "account_changed");
			return { undo: "tok", result: { version: 7 } };
		});
		const previewUpdateBalance = jest.fn(async () => ({ changes: [] }));
		const { device, outbox, writes } = deviceWith(
			{ accounts: { updateBalance, previewUpdateBalance } },
			async () => booked({ accountBase: { version: 4, balance: "1200" } }),
		);
		Object.assign(writes, {
			storedAccount: async () => ({
				version: 4,
				balance: "1200",
				closed: false,
			}),
		});
		const typed = {
			...balanceOp,
			body: { ...balanceOp.body, balance: "1500" },
		};
		expect(
			await writeAccountOnDevice({
				device,
				op: typed,
				opened: seen(4, "1000"),
			}),
		).toMatchObject({ settled: "parked" });
		expect(updateBalance).toHaveBeenCalledWith(
			expect.objectContaining({ balance: "1500", expectedBalance: "1000" }),
			expect.anything(),
		);
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({
			state: "conflict",
			lastError: "account_changed",
		});
		const clientId = entry?.clientId as string;
		const plan = await planAccountRebase({ outbox, writes, clientId });
		expect(plan?.payload).toMatchObject({
			balance: "1500",
			expectedBalance: "1200",
		});
		await accountOffer({
			outbox,
			api: device.api,
			writes,
			clientId,
			kind: "balance",
			options: { signal: new AbortController().signal },
			done: async () => true,
		});
		expect(previewUpdateBalance).toHaveBeenCalledWith(
			expect.objectContaining({
				balance: "1500",
				expectedBalance: "1200",
				expectedVersion: 4,
			}),
			expect.anything(),
		);
	});

	it("behind an unsent write, names the balance that write leaves, not the one the sheet showed", async () => {
		const close = jest.fn(async () => ({ undo: null, result: { version: 5 } }));
		const updateBalance = jest.fn(async () => ({
			undo: null,
			result: { version: 5 },
		}));
		const { device, outbox } = deviceWith(
			{ accounts: { close, updateBalance } },
			async () => booked({ accountBase: { version: 4, balance: "1200" } }),
		);
		await outbox.enqueue({
			clientId: "first",
			entity: "accounts",
			kind: "close",
			targetId: A,
			baseVersion: "4",
			payload: { id: A },
		});
		await writeAccountOnDevice({
			device,
			op: balanceOp,
			opened: seen(4, "1000"),
		});
		expect(updateBalance).toHaveBeenCalledWith(
			expect.objectContaining({ expectedBalance: "1200" }),
			expect.anything(),
		);
	});

	it("refuses to stack on a parked write to the account", async () => {
		const updateBalance = jest.fn(async () => {
			throw problem(409, "account_changed");
		});
		const { device } = deviceWith({ accounts: { updateBalance } }, async () =>
			booked(),
		);
		await writeAccountOnDevice({ device, op: balanceOp, opened: seen(3) });
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: seen(3) }),
		).toEqual({ settled: "blocked" });
	});
});

describe("a transfer under the flag", () => {
	it("a create is queued under its own id with the booking and sent", async () => {
		const create = jest.fn(async () => ({ undo: "tok" }));
		const { device } = deviceWith({ transfers: { create } }, async () =>
			booked({ accountBase: undefined }),
		);
		const body = {
			id: A,
			fromAccountId: A,
			toAccountId: null,
			fromAmount: "10",
		};
		expect(await createTransferOnDevice(device, body as never)).toMatchObject({
			settled: "synced",
			clientId: A,
		});
		expect(create).toHaveBeenCalledWith(body, expect.anything());
	});

	it("a delete is refused while another write names the transfer, and sent when none does", async () => {
		const del = jest.fn(async () => ({ undo: "tok" }));
		const { device, outbox } = deviceWith(
			{ transfers: { delete: del } },
			async () => booked({ accountBase: undefined }),
		);
		await outbox.enqueue({
			clientId: "c",
			entity: "transfers",
			kind: "create",
			targetId: A,
			baseVersion: null,
			payload: {},
		});
		expect(await deleteTransferOnDevice(device, A)).toEqual({
			settled: "busy",
		});
		await outbox.discard("c");
		expect(await deleteTransferOnDevice(device, A)).toMatchObject({
			settled: "synced",
		});
		expect(del).toHaveBeenCalledWith({ id: A }, expect.anything());
	});
});

describe("Undo of a device-booked wealth write", () => {
	it("before it was sent is a discard: no request, the entry is gone", async () => {
		const undo = jest.fn();
		const { device, outbox } = deviceWith({ accounts: { undo } }, async () =>
			booked(),
		);
		await outbox.enqueue({
			clientId: "unsent",
			entity: "accounts",
			kind: "balance",
			targetId: A,
			baseVersion: "4",
			payload: {},
		});
		const out = await undoSaved({
			outbox,
			api: device.api,
			clientId: "unsent",
			transport: apiTransport(device.api),
		});
		expect(out).toBe("undone");
		expect(undo).not.toHaveBeenCalled();
		expect(await outbox.all()).toEqual([]);
	});

	it("after it was sent goes through the server's undo token, never by replaying rows", async () => {
		const updateBalance = jest.fn(async () => ({
			undo: "the-token",
			result: { version: 7 },
		}));
		const undo = jest.fn(async () => ({}));
		const { device, outbox } = deviceWith(
			{ accounts: { updateBalance, undo } },
			async () => booked(),
		);
		const sent = await writeAccountOnDevice({
			device,
			op: balanceOp,
			opened: seen(4),
		});
		if (sent.settled !== "synced") throw new Error("not synced");
		const out = await undoSaved({
			outbox,
			api: device.api,
			clientId: sent.clientId,
			transport: apiTransport(device.api),
		});
		expect(out).toBe("undone");
		expect(undo).toHaveBeenCalledWith(
			{ token: "the-token" },
			expect.anything(),
		);
		// The acked write is taken out of the compare: it was undone, not different.
		expect(await outbox.acked()).toEqual([]);
	});
});
