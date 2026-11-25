import type { RetrospendClient } from "@retrospend/api-client";
import { bookedRow, booking } from "@/data/outboxFixtures";
import {
	apiTransport,
	classify,
	createEntrySender,
	forgetNotFound,
	KEY_REUSED,
	notFoundPull,
	PARKED_NO_STAMP,
	PARKED_NOT_FOUND,
	PARKED_STAMP,
} from "./send";

// The plain sender for an update and a delete: the stamp it checks against,
// what it sends, and how the server's refusals park.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const KEY = "11111111-1111-4111-8111-111111111111";
const STAMP = "2026-10-05T03:00:00.000Z";
const BODY = {
	id: ID,
	title: "Lunch",
	amount: "120",
	currency: "USD",
	date: "2026-10-05",
};

const entry = (over: Record<string, unknown> = {}) =>
	({
		clientId: KEY,
		entity: "expenses",
		kind: "update",
		targetId: ID,
		baseVersion: STAMP,
		payload: BODY,
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

const clientOf = (expenses: Record<string, jest.Mock>) =>
	({ expenses }) as never as RetrospendClient;

describe("sending an update", () => {
	it("puts the body with the stamp it was based on, under the entry's key, and names the new version", async () => {
		const update = jest.fn(async () => ({
			undo: "tok",
			expense: { updatedAt: "2026-10-05T03:00:09.000Z" },
		}));
		const sent = await createEntrySender(apiTransport(clientOf({ update })))(
			entry(),
		);
		expect(sent).toEqual({
			status: "sent",
			version: "2026-10-05T03:00:09.000Z",
		});
		expect(update).toHaveBeenCalledWith(
			{ ...BODY, expectedUpdatedAt: STAMP },
			expect.objectContaining({ context: { idempotencyKey: KEY } }),
		);
	});

	// The device's rows hold the booked figures; the server books again.
	it("body has no amountInUSD, homeAmount, exchangeRate or device row", async () => {
		const update = jest.fn(async () => ({ undo: "tok" }));
		const device = booking(
			ID,
			bookedRow(ID, { exchangeRate: "1545", version: STAMP }),
			bookedRow(ID, { amount: "120.00", homeAmount: "185400.00" }),
		);
		await createEntrySender(apiTransport(clientOf({ update })))(
			entry({ device }),
		);
		const [body] = update.mock.calls[0] as unknown as [Record<string, unknown>];
		expect(Object.keys(body).sort()).toEqual(
			[...Object.keys(BODY), "expectedUpdatedAt"].sort(),
		);
		for (const figure of ["amountInUSD", "homeAmount", "exchangeRate"])
			expect(body).not.toHaveProperty(figure);
	});

	it("is sent with no version when the answer named none", async () => {
		const update = jest.fn(async () => ({ undo: "tok" }));
		expect(
			await createEntrySender(apiTransport(clientOf({ update })))(entry()),
		).toEqual({
			status: "sent",
		});
	});

	it("never sends one with no stamp to check, or one still waiting on another entry", async () => {
		const update = jest.fn(async () => ({ undo: "tok" }));
		const send = createEntrySender(apiTransport(clientOf({ update })));
		for (const baseVersion of [null, { after: "other" }]) {
			expect(await send(entry({ baseVersion }))).toEqual({
				status: "conflict",
				reason: PARKED_NO_STAMP,
			});
		}
		expect(update).not.toHaveBeenCalled();
	});
});

describe("sending a delete", () => {
	it("sends the id in the path and the stamp in the query, and names no version", async () => {
		const del = jest.fn(async () => ({ id: ID, undo: "tok" }));
		const sent = await createEntrySender(
			apiTransport(clientOf({ delete: del })),
		)(entry({ kind: "delete", payload: { id: ID } }));
		expect(sent).toEqual({ status: "sent", version: null });
		expect(del).toHaveBeenCalledWith(
			{ params: { id: ID }, query: { expectedUpdatedAt: STAMP } },
			expect.objectContaining({ context: { idempotencyKey: KEY } }),
		);
	});
});

describe("refusals park", () => {
	it("expense_changed parks and is never retried", async () => {
		const update = jest.fn(async () => {
			throw problem(409, PARKED_STAMP);
		});
		expect(
			await createEntrySender(apiTransport(clientOf({ update })))(entry()),
		).toEqual({
			status: "conflict",
			reason: PARKED_STAMP,
			http: 409,
		});
	});

	it("keeps the code of a 404 and of a reused key", () => {
		expect(classify(problem(404, PARKED_NOT_FOUND))).toEqual({
			status: "conflict",
			reason: PARKED_NOT_FOUND,
			http: 404,
		});
		expect(classify(problem(422, KEY_REUSED))).toEqual({
			status: "conflict",
			reason: KEY_REUSED,
			http: 422,
		});
	});

	it("a 5xx retries twice more, then parks", () => {
		expect(classify(problem(503, "unavailable"), 2).status).toBe("retry");
		expect(classify(problem(503, "unavailable"), 3).status).toBe("conflict");
	});

	it("notes the pull count at a 404 of an update or a delete, and for nothing else", async () => {
		const missing = async () => {
			throw problem(404, PARKED_NOT_FOUND);
		};
		const send = createEntrySender(
			apiTransport(
				clientOf({
					update: jest.fn(missing),
					delete: jest.fn(missing),
					create: jest.fn(missing),
				}),
			),
			{ pullsBegun: () => 3 },
		);
		await send(entry({ clientId: "u" }));
		await send(entry({ clientId: "d", kind: "delete" }));
		await send(entry({ clientId: "c", kind: "create", baseVersion: null }));
		expect(notFoundPull("u")).toBe(3);
		expect(notFoundPull("d")).toBe(3);
		// A create has no row to be gone from; unknown reads as before every pull.
		expect(notFoundPull("c")).toBe(0);
		forgetNotFound("u");
		expect(notFoundPull("u")).toBe(0);
	});
});
