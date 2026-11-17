import type { RetrospendClient } from "@retrospend/api-client";
import { captureSent } from "@/data/captureSent";
import { createEntrySender } from "./send";

jest.mock("@/data/captureSent", () => ({ captureSent: jest.fn() }));

// The sender tells the dev capture about a create once the server has it, and
// only for a first try: a retry may be the replay of a try the server booked
// earlier, so its start says nothing about when the server booked it.

const entry = (attempts: number) =>
	({
		clientId: "11111111-1111-4111-8111-111111111111",
		entity: "expenses",
		kind: "create",
		targetId: "x",
		baseVersion: null,
		payload: { amount: "1", currency: "USD", date: "2026-10-05" },
		state: "pending",
		attempts,
		networkFailures: 0,
		serverErrors: 0,
		lastError: null,
		createdAt: 0,
	}) as never;

const apiOf = (create: jest.Mock) =>
	({ expenses: { create } }) as never as RetrospendClient;

beforeEach(() => jest.mocked(captureSent).mockClear());

describe("the entry sender", () => {
	it("captures a create the server accepted on the first try, with the time the send began", async () => {
		const before = Date.now();
		const api = apiOf(jest.fn(async () => ({ undo: "tok" })));
		await createEntrySender(api)(entry(0));
		expect(captureSent).toHaveBeenCalledTimes(1);
		const [client, sent, at] = jest.mocked(captureSent).mock.calls[0] ?? [];
		expect(client).toBe(api);
		expect(sent).toMatchObject({
			clientId: "11111111-1111-4111-8111-111111111111",
		});
		expect(at).toBeGreaterThanOrEqual(before);
		expect(at).toBeLessThanOrEqual(Date.now());
	});

	it("does not capture a retry", async () => {
		await createEntrySender(apiOf(jest.fn(async () => ({ undo: "tok" }))))(
			entry(1),
		);
		expect(captureSent).not.toHaveBeenCalled();
	});

	it("does not capture a create the server refused or one that never got an answer", async () => {
		await createEntrySender(
			apiOf(
				jest.fn(async () => {
					throw Object.assign(new Error("no"), { status: 422 });
				}),
			),
		)(entry(0));
		await createEntrySender(
			apiOf(
				jest.fn(async () => {
					throw new Error("offline");
				}),
			),
		)(entry(0));
		expect(captureSent).not.toHaveBeenCalled();
	});

	it("does not capture a create whose id the server already held", async () => {
		await createEntrySender(
			apiOf(
				jest.fn(async () => {
					throw Object.assign(new Error("taken"), {
						status: 409,
						code: "id_taken",
					});
				}),
			),
		)(entry(0));
		expect(captureSent).not.toHaveBeenCalled();
	});
});
