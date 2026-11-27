import type { RetrospendClient } from "@retrospend/api-client";
import { dispatchWealth } from "@retrospend/api-client/wealth-wire";
import {
	apiTransport,
	classify,
	createEntrySender,
	forgetUndoTokens,
	undoFor,
} from "./send";

// The plain sender for an account write and a transfer delete: the version it
// checks against, the ids and balance it names, what it adopts from the answer.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const KEY = "11111111-1111-4111-8111-111111111111";
const LEG = "22222222-2222-4222-8222-222222222222";
const SWITCH = "33333333-3333-4333-8333-333333333333";

const entry = (over: Record<string, unknown> = {}) =>
	({
		clientId: KEY,
		entity: "accounts",
		kind: "balance",
		targetId: ID,
		baseVersion: "4",
		payload: {
			balance: "1200",
			legId: LEG,
			rateTypeId: SWITCH,
			expectedBalance: "1000",
		},
		state: "pending",
		attempts: 1,
		networkFailures: 0,
		serverErrors: 0,
		lastError: null,
		createdAt: "",
		...over,
	}) as never;

const problem = (status: number, code: string) =>
	Object.assign(new Error(code), { status, code });

const clientOf = (api: Record<string, unknown>) =>
	api as never as RetrospendClient;
const send = (api: Record<string, unknown>, e: unknown) =>
	createEntrySender(apiTransport(clientOf(api)))(e as never);

const options = expect.objectContaining({ context: { idempotencyKey: KEY } });

beforeEach(forgetUndoTokens);

describe("sending an account write", () => {
	it("a balance update names the version and the stored balance it was based on, and the ids it booked under", async () => {
		const updateBalance = jest.fn(async () => ({
			undo: "tok",
			result: { version: 7 },
		}));
		const sent = await send({ accounts: { updateBalance } }, entry());
		expect(updateBalance).toHaveBeenCalledWith(
			{
				id: ID,
				balance: "1200",
				legId: LEG,
				rateTypeId: SWITCH,
				expectedBalance: "1000",
				expectedVersion: 4,
			},
			options,
		);
		// The version the answer named, as text: the device never counts the server's.
		expect(sent).toEqual({ status: "sent", version: "7" });
		expect(undoFor(KEY)).toMatchObject({
			entity: "accounts",
			token: "tok",
			target: ID,
		});
	});

	it("adopts a double-bumped version: an edit that changed a field and the rate type answers 6, not 5", async () => {
		const update = jest.fn(async () => ({
			undo: "tok",
			result: { version: 6, legId: LEG, rateTypeId: SWITCH },
		}));
		const sent = await send(
			{ accounts: { update } },
			entry({
				kind: "update",
				baseVersion: "4",
				payload: { name: "Wise", expectedBalance: "1000" },
			}),
		);
		expect(update).toHaveBeenCalledWith(
			{ name: "Wise", expectedBalance: "1000", id: ID, expectedVersion: 4 },
			options,
		);
		expect(sent).toEqual({ status: "sent", version: "6" });
	});

	it("close and reopen send the version alone", async () => {
		const close = jest.fn(async () => ({ undo: null, result: { version: 5 } }));
		const reopen = jest.fn(async () => ({ undo: "t", result: { version: 6 } }));
		expect(
			await send(
				{ accounts: { close } },
				entry({ kind: "close", payload: {} }),
			),
		).toEqual({ status: "sent", version: "5" });
		expect(close).toHaveBeenCalledWith({ id: ID, expectedVersion: 4 }, options);
		await send(
			{ accounts: { reopen } },
			entry({ kind: "reopen", payload: {} }),
		);
		expect(reopen).toHaveBeenCalledWith(
			{ id: ID, expectedVersion: 4 },
			options,
		);
	});

	it("a rate type switch sends the day and its row id", async () => {
		const setRateType = jest.fn(async () => ({
			undo: "t",
			result: { version: 5 },
		}));
		await send(
			{ accounts: { setRateType } },
			entry({
				kind: "rateType",
				payload: {
					rateType: "official",
					from: "2026-11-10",
					rateTypeId: SWITCH,
				},
			}),
		);
		expect(setRateType).toHaveBeenCalledWith(
			{
				id: ID,
				rateType: "official",
				from: "2026-11-10",
				rateTypeId: SWITCH,
				expectedVersion: 4,
			},
			options,
		);
	});

	it("a create goes out under its own id and names the new account's version", async () => {
		const create = jest.fn(async () => ({
			undo: "tok",
			result: { version: 0 },
		}));
		const sent = await send(
			{ accounts: { create } },
			entry({
				kind: "create",
				baseVersion: null,
				payload: { name: "Cash", type: "CASH", currency: "ARS", balance: "5" },
			}),
		);
		expect(create).toHaveBeenCalledWith(
			{ name: "Cash", type: "CASH", currency: "ARS", balance: "5", id: ID },
			options,
		);
		expect(sent).toEqual({ status: "sent", version: "0" });
	});

	it("never sends a write to an account with no version: parked as no_stamp, no request", async () => {
		const updateBalance = jest.fn();
		for (const baseVersion of [null, { after: "x" }]) {
			expect(
				await send({ accounts: { updateBalance } }, entry({ baseVersion })),
			).toEqual({ status: "conflict", reason: "no_stamp" });
		}
		expect(updateBalance).not.toHaveBeenCalled();
	});

	it("an answer with no token still counts as sent", async () => {
		const close = jest.fn(async () => ({ undo: null, result: { version: 5 } }));
		const sent = await send(
			{ accounts: { close } },
			entry({ kind: "close", payload: {} }),
		);
		expect(sent.status).toBe("sent");
	});
});

describe("the wire itself", () => {
	it("throws before any request for an account write that names no version", async () => {
		const updateBalance = jest.fn();
		const api = { accounts: { updateBalance } } as never as RetrospendClient;
		const options = { context: { idempotencyKey: KEY } } as never;
		for (const baseVersion of [null, { after: "x" }, "not-a-number"])
			await expect(
				dispatchWealth(api, entry({ baseVersion }), options),
			).rejects.toThrow(/needs the version it read/);
		expect(updateBalance).not.toHaveBeenCalled();
	});
});

describe("what a PUT answers about the ids it was given", () => {
	const putEntry = (payload: Record<string, unknown>) =>
		entry({ kind: "update", payload: { name: "Wise", ...payload } });
	const answered = (legId: string | null, rateTypeId: string | null) =>
		jest.fn(async () => ({
			undo: "t",
			result: { version: 6, legId, rateTypeId },
		}));

	it("names the ids it sent that the server did not write, as rows the device holds but the server has not", async () => {
		const update = answered(null, SWITCH);
		const sent = await send(
			{ accounts: { update } },
			putEntry({ legId: LEG, rateTypeId: SWITCH }),
		);
		expect(sent).toEqual({ status: "sent", version: "6", unwritten: [LEG] });
		const both = await send(
			{ accounts: { update: answered(null, null) } },
			putEntry({ legId: LEG, rateTypeId: SWITCH }),
		);
		expect(both).toMatchObject({ unwritten: [LEG, SWITCH] });
	});

	it("names nothing when the server used every id it was sent, or none was sent", async () => {
		expect(
			await send(
				{ accounts: { update: answered(LEG, SWITCH) } },
				putEntry({ legId: LEG, rateTypeId: SWITCH }),
			),
		).toEqual({ status: "sent", version: "6" });
		expect(
			await send({ accounts: { update: answered(null, null) } }, putEntry({})),
		).toEqual({ status: "sent", version: "6" });
	});
});

describe("sending a transfer delete", () => {
	it("deletes by id under the entry's key with no stamp, and sends nothing for a version", async () => {
		const del = jest.fn(async () => ({ undo: "tok" }));
		const sent = await send(
			{ transfers: { delete: del } },
			entry({
				entity: "transfers",
				kind: "delete",
				baseVersion: null,
				payload: { id: ID },
			}),
		);
		expect(del).toHaveBeenCalledWith({ id: ID }, options);
		expect(sent).toEqual({ status: "sent" });
		expect(undoFor(KEY)).toMatchObject({ entity: "transfers", token: "tok" });
	});
});

describe("the server's answers to a wealth write", () => {
	it("account_changed (409) parks with its code", async () => {
		const updateBalance = jest.fn(async () => {
			throw problem(409, "account_changed");
		});
		expect(await send({ accounts: { updateBalance } }, entry())).toEqual({
			status: "conflict",
			reason: "account_changed",
			http: 409,
		});
	});

	it("a lost answer: the id is taken, and the create counts as sent with no version", async () => {
		const create = jest.fn(async () => {
			throw problem(409, "id_taken");
		});
		expect(
			await send(
				{ accounts: { create } },
				entry({ kind: "create", baseVersion: null, payload: {} }),
			),
		).toEqual({ status: "sent" });
	});

	it("an offline answer retries and a 5xx retries as a server error", async () => {
		expect(classify(new Error("network"))).toMatchObject({
			status: "retry",
			kind: "network",
		});
		expect(
			classify(problem(503, "unavailable"), 0, { entity: "accounts" }),
		).toMatchObject({ status: "retry", kind: "server" });
	});
});
