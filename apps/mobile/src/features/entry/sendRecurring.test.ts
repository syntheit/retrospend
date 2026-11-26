import type { RetrospendClient } from "@retrospend/api-client";
import {
	PROBLEM_STATUS,
	type ProblemCode,
} from "@retrospend/api-contract/errors";
import { createOutbox, type OutboxEntry } from "@/data/outbox";
import { confirm, templateEdit } from "@/data/outboxFixtures";
import { createMemoryStore } from "@/data/store";
import { flushOutbox } from "@/data/sync";
import {
	apiTransport,
	classify,
	createEntrySender,
	entryOutbox,
	forgetNotFound,
	forgetUndoTokens,
	notFoundPull,
	PARKED_NO_DUE,
	PARKED_NO_STAMP,
	undoFor,
	undoWith,
} from "./send";

// The plain sender for a recurring confirm and skip: what it sends (the
// client expense id, the due date, the stamp from the chain), how each typed
// answer is classified, and where an undo goes.

const TEMPLATE = "t1";
const KEY = "0b1f6d6e-3c1a-4f1e-9a57-5c1f4d3a2b10";
const KEY2 = "9d2c7a1e-8b34-4c55-a1e0-2f6b7c8d9e01";
const DUE = "2026-12-01T03:00:00.000Z";
const STAMP = "2026-11-18T10:00:00.000Z";
const STAMP2 = "2026-12-01T03:05:00.000Z";

// Every code and status here is the contract's (PROBLEM_STATUS), not send.ts's
// own constants, so a code that drifted from the contract fails these tests.
const CODE = {
	alreadyPosted: "recurring_already_posted",
	notDue: "recurring_not_due",
	changed: "recurring_changed",
	protectedAccount: "protected_account",
	idTaken: "id_taken",
	notFound: "not_found",
} as const satisfies Record<string, ProblemCode>;

const problem = (code: ProblemCode, status: number = PROBLEM_STATUS[code]) =>
	Object.assign(new Error(code), { status, code });

const entry = (over: Record<string, unknown> = {}) =>
	({
		...confirm(KEY, TEMPLATE, STAMP, { payload: { dueAt: DUE } }),
		state: "pending",
		attempts: 1,
		networkFailures: 0,
		serverErrors: 0,
		lastError: null,
		createdAt: "",
		...over,
	}) as OutboxEntry;

const recurringApi = () => {
	const recurring = {
		confirm: jest.fn(async () => ({
			undo: "tok-c",
			confirmed: { templateUpdatedAt: STAMP2 },
		})),
		skip: jest.fn(async () => ({
			undo: "tok-s",
			skipped: { templateUpdatedAt: STAMP2 },
		})),
		undo: jest.fn(async () => ({})),
		undoSkip: jest.fn(async () => ({})),
	};
	const expenses = {
		create: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	};
	return {
		recurring,
		expenses,
		api: { recurring, expenses } as never as RetrospendClient,
	};
};

beforeEach(() => {
	forgetUndoTokens();
	forgetNotFound(KEY);
});

describe("sending a recurring confirm", () => {
	it("posts the template's confirm with the client expense id, the due date and the stamp, under the entry's key", async () => {
		const { api, recurring } = recurringApi();
		const sent = await createEntrySender(apiTransport(api))(entry());
		expect(sent).toEqual({ status: "sent", version: STAMP2 });
		expect(recurring.confirm).toHaveBeenCalledWith(
			{
				id: TEMPLATE,
				expenseId: KEY,
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
			},
			expect.objectContaining({ context: { idempotencyKey: KEY } }),
		);
	});

	it("a poster entry's confirm is an auto post: the server books it as its sweep does, a person's is not", async () => {
		const { api, recurring } = recurringApi();
		await createEntrySender(apiTransport(api))(entry({ origin: "poster" }));
		expect(recurring.confirm).toHaveBeenCalledWith(
			{
				id: TEMPLATE,
				expenseId: KEY,
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
				auto: true,
			},
			expect.anything(),
		);
		recurring.confirm.mockClear();
		await createEntrySender(apiTransport(api))(entry());
		expect(recurring.confirm.mock.calls[0]?.[0]).not.toHaveProperty("auto");
	});

	it("names the booked expense's own version when the answer carries one; an older server's answer gives none", async () => {
		const { api, recurring } = recurringApi();
		recurring.confirm.mockResolvedValueOnce({
			undo: "tok-c",
			confirmed: { templateUpdatedAt: STAMP2, expenseUpdatedAt: STAMP },
		} as never);
		expect(await createEntrySender(apiTransport(api))(entry())).toEqual({
			status: "sent",
			version: STAMP2,
			expenseVersion: STAMP,
		});
		// Income answers null, and a server before 1.12.0 leaves it out: no version either way.
		recurring.confirm.mockResolvedValueOnce({
			undo: "tok-c",
			confirmed: { templateUpdatedAt: STAMP2, expenseUpdatedAt: null },
		} as never);
		expect(await createEntrySender(apiTransport(api))(entry())).toEqual({
			status: "sent",
			version: STAMP2,
		});
	});

	it("sends the typed amount and the paid-on day, and nothing else the payload held", async () => {
		const { api, recurring } = recurringApi();
		await createEntrySender(apiTransport(api))(
			entry({
				payload: {
					dueAt: DUE,
					amount: "18.50",
					paidOn: "2026-11-29",
					expenseId: "someone-else",
					title: "never sent",
				},
			}),
		);
		expect(recurring.confirm).toHaveBeenCalledWith(
			{
				id: TEMPLATE,
				expenseId: KEY,
				dueAt: DUE,
				expectedUpdatedAt: STAMP,
				amount: "18.50",
				paidOn: "2026-11-29",
			},
			expect.anything(),
		);
	});

	it("a confirm that names no stamp or no due date is parked, never sent", async () => {
		const { api, recurring } = recurringApi();
		const send = createEntrySender(apiTransport(api));
		expect(await send(entry({ baseVersion: null }))).toEqual({
			status: "conflict",
			reason: PARKED_NO_STAMP,
		});
		expect(await send(entry({ payload: { amount: "1" } }))).toEqual({
			status: "conflict",
			reason: PARKED_NO_DUE,
		});
		expect(await send(entry({ payload: { dueAt: "soon" } }))).toEqual({
			status: "conflict",
			reason: PARKED_NO_DUE,
		});
		expect(recurring.confirm).not.toHaveBeenCalled();
	});

	it("keeps the undo token with the entry's kind, and names no version for recurring income", async () => {
		const { api, recurring } = recurringApi();
		recurring.confirm.mockResolvedValueOnce({
			undo: "tok-in",
			confirmed: { templateUpdatedAt: null as never },
		});
		const sent = await createEntrySender(apiTransport(api))(entry());
		expect(sent).toEqual({ status: "sent", version: null });
		expect(undoFor(KEY)).toEqual({
			entity: "recurring",
			token: "tok-in",
			target: TEMPLATE,
			kind: "confirm",
		});
	});
});

describe("sending a recurring skip", () => {
	it("posts the skip with the due date and the stamp, and never a confirm", async () => {
		const { api, recurring } = recurringApi();
		const skip = entry({ kind: "skip", payload: { dueAt: DUE, amount: "9" } });
		expect(await createEntrySender(apiTransport(api))(skip)).toEqual({
			status: "sent",
			version: STAMP2,
		});
		expect(recurring.skip).toHaveBeenCalledWith(
			{ id: TEMPLATE, dueAt: DUE, expectedUpdatedAt: STAMP },
			expect.objectContaining({ context: { idempotencyKey: KEY } }),
		);
		expect(recurring.confirm).not.toHaveBeenCalled();
		expect(undoFor(KEY)).toMatchObject({ kind: "skip" });
	});
});

describe("routing by kind", () => {
	it("a confirm filed under expenses has no sender and no request goes out", async () => {
		const { api, recurring, expenses } = recurringApi();
		const sent = await createEntrySender(apiTransport(api))(
			entry({ entity: "expenses" }),
		);
		expect(sent).toMatchObject({ status: "retry" });
		expect(expenses.update).not.toHaveBeenCalled();
		expect(recurring.confirm).not.toHaveBeenCalled();
	});

	it("the transport refuses an unknown kind and a kind its entity has no call for, before any request", async () => {
		const { api, recurring, expenses } = recurringApi();
		const transport = apiTransport(api);
		const options = {
			context: { idempotencyKey: KEY },
			signal: new AbortController().signal,
			sealed: { bytes: undefined, keep: async () => undefined },
		};
		for (const bad of [
			entry({ kind: "wat" }),
			entry({ entity: "expenses" }),
			// A template has no delete on this transport: it stays online.
			{ ...entry({ kind: "delete" }), entity: "recurring" } as OutboxEntry,
		])
			await expect(transport.dispatch(bad, options)).rejects.toThrow();
		expect(recurring.confirm).not.toHaveBeenCalled();
		expect(expenses.update).not.toHaveBeenCalled();
		expect(expenses.create).not.toHaveBeenCalled();
	});

	it("a template create and edit are the sender's, and a template delete is not and does not stop the queue", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(templateEdit("e1", TEMPLATE, STAMP));
		await outbox.enqueue({
			...templateEdit("e2", "t2", null),
			kind: "create",
		});
		await outbox.enqueue({
			...templateEdit("e4", "t4", STAMP),
			kind: "delete",
		});
		await outbox.enqueue(confirm(KEY, "t3", STAMP));
		expect((await entryOutbox(outbox).all()).map((e) => e.clientId)).toEqual([
			"e1",
			"e2",
			KEY,
		]);
	});
});

describe("classifying a recurring answer", () => {
	const answer = (
		code: ProblemCode,
		origin?: "poster" | "user",
		status: number = PROBLEM_STATUS[code],
	) =>
		classify(problem(code, status), 0, {
			entity: "recurring",
			...(origin ? { origin } : {}),
		});

	it("recurring_already_posted retires a poster entry and parks a person's, which waits for a pull", () => {
		expect(answer(CODE.alreadyPosted, "poster")).toEqual({
			status: "retired",
		});
		expect(answer(CODE.alreadyPosted)).toEqual({
			status: "conflict",
			reason: CODE.alreadyPosted,
			http: 409,
		});
		expect(answer(CODE.alreadyPosted, "user")).toMatchObject({
			status: "conflict",
		});
	});

	it("recurring_changed retires a poster entry and parks a person's", () => {
		expect(answer(CODE.changed, "poster")).toEqual({
			status: "retired",
		});
		expect(answer(CODE.changed)).toEqual({
			status: "conflict",
			reason: CODE.changed,
			http: 409,
		});
	});

	it("recurring_not_due waits for either, and is never a conflict", () => {
		expect(answer(CODE.notDue, "poster")).toEqual({
			status: "later",
		});
		expect(answer(CODE.notDue)).toEqual({ status: "later" });
	});

	it("protected_account stops the run and keeps the entry, for either", () => {
		for (const origin of ["poster", "user"] as const)
			expect(answer(CODE.protectedAccount, origin)).toEqual({
				status: "retry",
				reason: CODE.protectedAccount,
				kind: "network",
			});
	});

	it("a 404 parks as not_found, a taken id parks as id_taken", () => {
		expect(answer(CODE.notFound, "poster")).toEqual({
			status: "conflict",
			reason: CODE.notFound,
			http: 404,
		});
		expect(answer(CODE.idTaken, "poster")).toEqual({
			status: "conflict",
			reason: CODE.idTaken,
			http: 409,
		});
	});

	it("keeps the common rules for a recurring entry: network, 5xx and a refused amount", () => {
		expect(
			classify(new TypeError("offline"), 0, { entity: "recurring" }),
		).toMatchObject({ status: "retry", kind: "network" });
		expect(answer("bad_request", undefined, 500)).toEqual({
			status: "retry",
			reason: "bad_request",
			kind: "server",
		});
		expect(answer("missing_rate")).toEqual({
			status: "conflict",
			reason: "missing_rate",
			http: 422,
		});
	});

	it("the typed answers mean nothing to another entity: an expense edit still parks", () => {
		expect(
			classify(problem(CODE.alreadyPosted), 0, {
				entity: "expenses",
				origin: "poster",
			}),
		).toMatchObject({ status: "conflict" });
		expect(classify(problem(CODE.notDue))).toMatchObject({
			status: "conflict",
		});
	});
});

describe("answers through the sender", () => {
	it("a taken id on a confirm books nothing and parks: it is never counted as sent", async () => {
		const { api, recurring } = recurringApi();
		recurring.confirm.mockRejectedValueOnce(problem(CODE.idTaken));
		const sent = await createEntrySender(apiTransport(api))(entry());
		expect(sent).toEqual({
			status: "conflict",
			reason: CODE.idTaken,
			http: 409,
		});
		// Not a gone template: a pull resolves nothing for it.
		expect(notFoundPull(KEY)).toBe(0);
	});

	it("a 404 notes the pull it arrived in, so only a later pull can resolve it", async () => {
		const { api, recurring } = recurringApi();
		recurring.confirm.mockRejectedValueOnce(problem(CODE.notFound));
		await createEntrySender(apiTransport(api), { pullsBegun: () => 7 })(
			entry(),
		);
		expect(notFoundPull(KEY)).toBe(7);
	});

	it("a person's already-posted answer notes the pull too", async () => {
		const { api, recurring } = recurringApi();
		recurring.confirm.mockRejectedValueOnce(problem(CODE.alreadyPosted));
		await createEntrySender(apiTransport(api), { pullsBegun: () => 5 })(
			entry(),
		);
		expect(notFoundPull(KEY)).toBe(5);
	});
});

describe("the stamp chain", () => {
	it("the second poster confirm carries the first ack's templateUpdatedAt", async () => {
		const { api, recurring } = recurringApi();
		const outbox = createOutbox(createMemoryStore(), "a");
		const poster = { origin: "poster" } as const;
		await outbox.enqueue(confirm(KEY, TEMPLATE, STAMP, poster));
		await outbox.enqueue(
			confirm(
				KEY2,
				TEMPLATE,
				{ after: KEY },
				{
					...poster,
					payload: { dueAt: "2027-01-01T03:00:00.000Z" },
				},
			),
		);
		const report = await flushOutbox(
			outbox,
			createEntrySender(apiTransport(api)),
		);
		expect(report).toMatchObject({ sent: 2, conflicts: 0 });
		const stamps = (
			recurring.confirm.mock.calls as unknown as [
				{ expectedUpdatedAt: string },
			][]
		).map(([body]) => body.expectedUpdatedAt);
		expect(stamps).toEqual([STAMP, STAMP2]);
	});
});

describe("undo of a recurring write", () => {
	const ref = { entity: "recurring", token: "tok" } as const;

	it("a confirm goes to /recurring/undo and a skip to /recurring/skip/undo, under the key", async () => {
		const { api, recurring } = recurringApi();
		const transport = apiTransport(api);
		await undoWith(transport, { ...ref, kind: "confirm" }, KEY, 2);
		expect(recurring.undo).toHaveBeenCalledWith(
			{ token: "tok" },
			expect.objectContaining({ context: { idempotencyKey: `${KEY}-undo-2` } }),
		);
		expect(recurring.undoSkip).not.toHaveBeenCalled();
		await undoWith(transport, { ...ref, kind: "skip" }, KEY2);
		expect(recurring.undoSkip).toHaveBeenCalledWith(
			{ token: "tok" },
			expect.objectContaining({ context: { idempotencyKey: `${KEY2}-undo` } }),
		);
		expect(recurring.undo).toHaveBeenCalledTimes(1);
	});

	it("a token that does not say which kind it undoes is refused with no request", async () => {
		const { api, recurring } = recurringApi();
		await expect(undoWith(apiTransport(api), ref, KEY)).rejects.toThrow();
		expect(recurring.undo).not.toHaveBeenCalled();
		expect(recurring.undoSkip).not.toHaveBeenCalled();
	});
});
