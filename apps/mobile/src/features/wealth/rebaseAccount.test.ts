import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceWrites } from "@/data/device-engine";
import { createOutbox, type NewOutboxEntry } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { parkedFrom, rebases } from "@/features/entry/parked-entry";
import { resolveParked } from "@/features/entry/parked-resolve";
import { forgetNotFound } from "@/features/entry/send";
import {
	accountOffer,
	commitAccountRebase,
	planAccountRebase,
} from "./rebaseAccount";

// Try again on a parked account statement: saved again over the account as a
// pull left it, under new row ids, with the pulled version and stored balance.
// An edit of the whole account is never re-based. A write whose account or
// transfer a pull shows gone is told so, or leaves without a word.

const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));
let mockN = 0;
jest.mock("@/data/ids", () => ({
	newClientId: () =>
		`00000000-0000-4000-8000-${String(++mockN).padStart(12, "0")}`,
}));

const A = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";

const writesWith = (over: Partial<DeviceWrites> = {}) =>
	({
		book: jest.fn(async () => ({
			bookedAt: 1,
			changes: [],
			changed: [],
			base: null,
		})),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 3,
		absentSince: jest.fn(async () => false),
		storedAccount: jest.fn(async () => ({
			version: 9,
			balance: "1100",
			closed: false,
		})),
		...over,
	}) as unknown as DeviceWrites & Record<string, jest.Mock>;

async function parkedWith(
	entry: Partial<NewOutboxEntry> & Pick<NewOutboxEntry, "kind">,
	lastError = "account_changed",
) {
	const outbox = createOutbox(createMemoryStore(), "s");
	await outbox.enqueue({
		clientId: "old",
		entity: "accounts",
		targetId: A,
		baseVersion: "4",
		payload: { id: A },
		...entry,
	});
	await outbox.markConflict("old", lastError);
	return outbox;
}

const balance = {
	kind: "balance" as const,
	payload: {
		id: A,
		balance: "1200",
		legId: "x",
		rateTypeId: "y",
		expectedBalance: "1000",
	},
};

beforeEach(() => {
	mockN = 0;
	mockWrites.mockReset();
	forgetNotFound("old");
});

describe("planAccountRebase", () => {
	it("restates a balance update over the pulled account: its version and stored balance, new row ids", async () => {
		const outbox = await parkedWith(balance);
		const plan = await planAccountRebase({
			outbox,
			writes: writesWith(),
			clientId: "old",
		});
		expect(plan?.version).toBe(9);
		expect(plan?.op).toMatchObject({
			kind: "accountBalance",
			body: { id: A, balance: "1200" },
		});
		// The old ids went with the refused write: the new one names its own rows.
		expect(plan?.payload).toMatchObject({ expectedBalance: "1100" });
		expect(plan?.payload.legId).not.toBe("x");
		expect(plan?.payload.rateTypeId).not.toBe("y");
	});

	it("restates a rate type switch with its day, and a close of an open account", async () => {
		const sw = await parkedWith({
			kind: "rateType",
			payload: {
				id: A,
				rateType: "official",
				from: "2026-11-10",
				rateTypeId: "z",
			},
		});
		expect(
			(
				await planAccountRebase({
					outbox: sw,
					writes: writesWith(),
					clientId: "old",
				})
			)?.op,
		).toMatchObject({
			kind: "accountRateType",
			body: { id: A, rateType: "official", from: "2026-11-10" },
		});
		const close = await parkedWith({ kind: "close" });
		expect(
			(
				await planAccountRebase({
					outbox: close,
					writes: writesWith(),
					clientId: "old",
				})
			)?.op.kind,
		).toBe("accountClose");
	});

	it("has nothing to save when the account already is in the state asked for", async () => {
		const closed = writesWith({
			storedAccount: async () => ({ version: 9, balance: "1", closed: true }),
		});
		const close = await parkedWith({ kind: "close" });
		expect(
			await planAccountRebase({
				outbox: close,
				writes: closed,
				clientId: "old",
			}),
		).toBeNull();
		const reopen = await parkedWith({ kind: "reopen" });
		expect(
			(
				await planAccountRebase({
					outbox: reopen,
					writes: closed,
					clientId: "old",
				})
			)?.op.kind,
		).toBe("accountReopen");
		expect(
			await planAccountRebase({
				outbox: reopen,
				writes: writesWith(),
				clientId: "old",
			}),
		).toBeNull();
	});

	it("never re-bases a whole-account edit, an account the store does not hold, or an entry that is not parked", async () => {
		const edit = await parkedWith({
			kind: "update",
			payload: { id: A, name: "x" },
		});
		expect(
			await planAccountRebase({
				outbox: edit,
				writes: writesWith(),
				clientId: "old",
			}),
		).toBeNull();
		const gone = await parkedWith(balance);
		expect(
			await planAccountRebase({
				outbox: gone,
				writes: writesWith({ storedAccount: async () => null }),
				clientId: "old",
			}),
		).toBeNull();
		const waiting = createOutbox(createMemoryStore(), "s");
		await waiting.enqueue({
			clientId: "old",
			entity: "accounts",
			kind: "balance",
			targetId: A,
			baseVersion: "4",
			payload: {},
		});
		expect(
			await planAccountRebase({
				outbox: waiting,
				writes: writesWith(),
				clientId: "old",
			}),
		).toBeNull();
	});
});

describe("commitAccountRebase", () => {
	it("swaps the parked entry for a new one based on the pulled version, booked over the pulled account", async () => {
		const outbox = await parkedWith(balance);
		const writes = writesWith();
		const plan = await planAccountRebase({ outbox, writes, clientId: "old" });
		if (!plan) throw new Error("no plan");
		const next = await commitAccountRebase({
			outbox,
			writes,
			clientId: "old",
			plan,
		});
		expect(next).not.toBeNull();
		const all = await outbox.all();
		expect(all.map((e) => e.clientId)).toEqual([next]);
		expect(all[0]).toMatchObject({
			kind: "balance",
			baseVersion: "9",
			state: "pending",
			payload: { balance: "1200", expectedBalance: "1100" },
		});
		expect(writes.book).toHaveBeenCalledWith(plan.op);
	});

	it("does nothing when the entry is not parked any more", async () => {
		const outbox = await parkedWith(balance);
		const writes = writesWith();
		const plan = await planAccountRebase({ outbox, writes, clientId: "old" });
		if (!plan) throw new Error("no plan");
		await outbox.requeue("old");
		expect(
			await commitAccountRebase({ outbox, writes, clientId: "old", plan }),
		).toBeNull();
	});
});

describe("accountOffer", () => {
	it("shows the server's dry run against the pulled version and balance, and saves only on the person's word", async () => {
		const outbox = await parkedWith(balance);
		const previewUpdateBalance = jest.fn(async () => ({ changes: [] }));
		const api = {
			accounts: { previewUpdateBalance },
		} as never as RetrospendClient;
		const done = jest.fn(async () => true);
		const offer = await accountOffer({
			outbox,
			api,
			writes: writesWith(),
			clientId: "old",
			kind: "balance",
			options: { signal: new AbortController().signal },
			done,
		});
		expect(previewUpdateBalance).toHaveBeenCalledWith(
			expect.objectContaining({
				id: A,
				balance: "1200",
				expectedVersion: 9,
				expectedBalance: "1100",
			}),
			expect.anything(),
		);
		expect(done).not.toHaveBeenCalled();
		expect(await offer?.save()).toBe(true);
		expect(done).toHaveBeenCalledTimes(1);
	});
});

describe("the parked row of an account write", () => {
	it("account_changed re-bases a statement and leaves a whole-account edit to Discard", () => {
		const statement = parkedFrom({
			...balance,
			clientId: "c",
			entity: "accounts",
			targetId: A,
			lastError: "account_changed",
		} as never);
		expect(rebases(statement)).toBe(true);
		const edit = parkedFrom({
			clientId: "c",
			entity: "accounts",
			kind: "update",
			targetId: A,
			payload: {},
			lastError: "account_changed",
		} as never);
		expect(edit.retryable).toBe(false);
	});

	it("a taken id on a new account or transfer is Discard only", () => {
		for (const entity of ["accounts", "transfers"])
			expect(
				parkedFrom({
					clientId: "c",
					entity,
					kind: "create",
					targetId: A,
					payload: {},
					lastError: "id_taken",
				} as never).retryable,
			).toBe(false);
	});
});

describe("a 404 retires only after a pull shows the row gone", () => {
	const api = {} as RetrospendClient;
	const entryOf = (entity: string, kind: string) =>
		({
			clientId: "old",
			entity,
			kind,
			targetId: A,
			baseVersion: "4",
			payload: {},
			state: "conflict",
			lastError: "not_found",
			attempts: 1,
			networkFailures: 0,
			serverErrors: 0,
			createdAt: "",
		}) as never;

	it("an account statement stays Couldn't sync until a pull shows the account gone, then says so", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		const writes = writesWith();
		mockWrites.mockReturnValue(writes);
		expect(
			(await resolveParked(outbox, api, entryOf("accounts", "balance")))?.gone,
		).toBe(false);
		(writes.absentSince as unknown as jest.Mock).mockResolvedValue(true);
		const gone = await resolveParked(
			outbox,
			api,
			entryOf("accounts", "balance"),
		);
		expect(gone).toMatchObject({ gone: true, retryable: false });
		expect(writes.absentSince).toHaveBeenLastCalledWith(A, 0, "accounts");
	});

	it("an account that moved under a write (account_changed) is told as gone when a pull shows it gone", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		const writes = writesWith({ absentSince: jest.fn(async () => true) });
		mockWrites.mockReturnValue(writes);
		const moved = {
			...(entryOf("accounts", "close") as object),
			lastError: "account_changed",
		} as never;
		expect(await resolveParked(outbox, api, moved)).toMatchObject({
			gone: true,
		});
	});

	it("a transfer delete leaves without a word once a pull shows the transfer gone, and not before", async () => {
		const outbox = createOutbox(createMemoryStore(), "s");
		await outbox.enqueue({
			clientId: "old",
			entity: "transfers",
			kind: "delete",
			targetId: A,
			baseVersion: null,
			payload: {},
		});
		await outbox.markConflict("old", "not_found");
		const writes = writesWith();
		mockWrites.mockReturnValue(writes);
		expect(
			await resolveParked(outbox, api, entryOf("transfers", "delete")),
		).not.toBeNull();
		expect(await outbox.all()).toHaveLength(1);
		(writes.absentSince as unknown as jest.Mock).mockResolvedValue(true);
		expect(
			await resolveParked(outbox, api, entryOf("transfers", "delete")),
		).toBeNull();
		expect(writes.absentSince).toHaveBeenLastCalledWith(A, 0, "transfers");
		expect(await outbox.all()).toEqual([]);
	});
});
