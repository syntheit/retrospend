import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox } from "@/data/outbox";
import { confirm } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { flushEntries, undoSaved } from "./queue";
import {
	apiTransport,
	forgetNotFound,
	forgetUndoTokens,
	RECURRING_ALREADY_POSTED,
	RECURRING_NOT_DUE,
} from "./send";
import { forgetSent, recentlySent } from "./sentRetain";

// The queue around recurring writes: a retired entry is never kept as sent, a
// not-yet entry blocks nothing, and Undo takes a confirm or a skip back
// through its own route.

jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => null }));

const STAMP = "2026-11-18T10:00:00.000Z";
const NEXT = "2026-12-01T03:05:00.000Z";

const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

const setup = () => {
	const recurring = {
		confirm: jest.fn(async () => ({
			undo: "tok-c",
			confirmed: { templateUpdatedAt: NEXT },
		})),
		skip: jest.fn(async () => ({
			undo: "tok-s",
			skipped: { templateUpdatedAt: NEXT },
		})),
		undo: jest.fn(async () => ({})),
		undoSkip: jest.fn(async () => ({})),
	};
	const api = { recurring } as never as RetrospendClient;
	return {
		recurring,
		api,
		transport: apiTransport(api),
		outbox: createOutbox(createMemoryStore(), "scope"),
	};
};

beforeEach(() => {
	forgetUndoTokens();
	forgetSent();
	for (const id of ["c1", "c2", "s1"]) forgetNotFound(id);
});

describe("a flush of recurring entries", () => {
	it("keeps a sent entry as sent, and never a retired one or the poster entries dropped with it", async () => {
		const { api, transport, outbox, recurring } = setup();
		const poster = { origin: "poster" } as const;
		await outbox.enqueue(confirm("c1", "t1", STAMP, poster));
		await outbox.enqueue(confirm("c2", "t1", { after: "c1" }, poster));
		await outbox.enqueue(confirm("d1", "t2", STAMP, poster));
		recurring.confirm.mockRejectedValueOnce(
			problem(409, RECURRING_ALREADY_POSTED),
		);
		await flushEntries(outbox, api, transport);
		expect(await outbox.all()).toEqual([]);
		// c1 retired and c2 went with it: only d1 reached the server.
		expect(recentlySent().map((e) => e.clientId)).toEqual(["d1"]);
	});

	it("a not-yet poster entry stays queued, is not read as one that may be on the server, and Undo takes it back with no request", async () => {
		const { api, transport, outbox, recurring } = setup();
		await outbox.enqueue(confirm("c1", "t1", STAMP, { origin: "poster" }));
		recurring.confirm.mockRejectedValueOnce(problem(409, RECURRING_NOT_DUE));
		const report = await flushEntries(outbox, api, transport);
		expect(report).toMatchObject({ later: 1, sent: 0, stopped: false });
		const [waiting] = await outbox.all();
		expect(waiting).toMatchObject({ state: "pending", attempts: 0 });
		expect(recentlySent()).toEqual([]);

		expect(await undoSaved({ outbox, api, clientId: "c1", transport })).toBe(
			"undone",
		);
		expect(await outbox.all()).toEqual([]);
		// Nothing was resent: the one request was the refused first try.
		expect(recurring.confirm).toHaveBeenCalledTimes(1);
	});

	it("Undo of an entry whose resend meets not-yet is proven not stored and is taken back", async () => {
		const { api, transport, outbox, recurring } = setup();
		await outbox.enqueue(confirm("c1", "t1", STAMP));
		await outbox.markSending("c1");
		await outbox.markFailed("c1", "offline");
		recurring.confirm.mockRejectedValueOnce(problem(409, RECURRING_NOT_DUE));
		expect(await undoSaved({ outbox, api, clientId: "c1", transport })).toBe(
			"undone",
		);
		expect(await outbox.all()).toEqual([]);
	});
});

describe("Undo of a sent recurring write", () => {
	it("a confirm is undone through /recurring/undo with the token the server gave", async () => {
		const { api, transport, outbox, recurring } = setup();
		await outbox.enqueue(confirm("c1", "t1", STAMP));
		await flushEntries(outbox, api, transport);
		expect(await undoSaved({ outbox, api, clientId: "c1", transport })).toBe(
			"undone",
		);
		expect(recurring.undo).toHaveBeenCalledWith(
			{ token: "tok-c" },
			expect.objectContaining({ context: { idempotencyKey: "c1-undo" } }),
		);
		expect(recurring.undoSkip).not.toHaveBeenCalled();
	});

	it("a skip is undone through /recurring/skip/undo", async () => {
		const { api, transport, outbox, recurring } = setup();
		await outbox.enqueue({ ...confirm("s1", "t1", STAMP), kind: "skip" });
		await flushEntries(outbox, api, transport);
		expect(await undoSaved({ outbox, api, clientId: "s1", transport })).toBe(
			"undone",
		);
		expect(recurring.undoSkip).toHaveBeenCalledWith(
			{ token: "tok-s" },
			expect.anything(),
		);
		expect(recurring.undo).not.toHaveBeenCalled();
	});
});
