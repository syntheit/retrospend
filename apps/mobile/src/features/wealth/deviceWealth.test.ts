import type { RetrospendClient } from "@retrospend/api-client";
import type { BookedWrite } from "@retrospend/engine/device";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { flushEntries } from "@/features/entry/queue";
import { apiTransport, forgetUndoTokens } from "@/features/entry/send";
import {
	createAccountOnDevice,
	createTransferOnDevice,
	deleteTransferOnDevice,
	type WealthDevice,
	writeAccountOnDevice,
} from "./deviceWealth";

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
			await writeAccountOnDevice({ device, op: balanceOp, opened: 4 }),
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
	it("books, queues with the screen's version and the device's stored balance, and sends it", async () => {
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
			opened: 5,
		});
		expect(out).toMatchObject({ settled: "synced" });
		expect(updateBalance).toHaveBeenCalledWith(
			{
				...balanceOp.body,
				expectedBalance: "1000",
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
			await writeAccountOnDevice({ device, op: balanceOp, opened: 4 }),
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
			await writeAccountOnDevice({ device, op: balanceOp, opened: 4 }),
		).toMatchObject({ settled: "queued" });
		// The send began and no answer is known: it may be on the server, so nothing stacks on it.
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: 4 }),
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
			await writeAccountOnDevice({ device, op: balanceOp, opened: 4 }),
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
			opened: 4,
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
			await writeAccountOnDevice({ device, op: balanceOp, opened: 3 }),
		).toMatchObject({ settled: "parked" });
		const [entry] = await outbox.all();
		expect(entry).toMatchObject({
			state: "conflict",
			lastError: "account_changed",
		});
	});

	it("refuses to stack on a parked write to the account", async () => {
		const updateBalance = jest.fn(async () => {
			throw problem(409, "account_changed");
		});
		const { device } = deviceWith({ accounts: { updateBalance } }, async () =>
			booked(),
		);
		await writeAccountOnDevice({ device, op: balanceOp, opened: 3 });
		expect(
			await writeAccountOnDevice({ device, op: balanceOp, opened: 3 }),
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
