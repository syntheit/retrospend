import type { RetrospendClient } from "@retrospend/api-client";
import { createEntrySender } from "./send";

jest.mock("@/data/captureSent", () => ({
	captureSent: jest.fn(),
	dropCaptured: jest.fn(),
}));

// An entry chained after a create takes the version the create's answer names.

const entry = (entity: string) =>
	({
		clientId: "11111111-1111-4111-8111-111111111111",
		entity,
		kind: "create",
		targetId: "x",
		baseVersion: null,
		payload: {},
		state: "pending",
		attempts: 0,
		networkFailures: 0,
		serverErrors: 0,
		lastError: null,
		createdAt: "",
	}) as never;

const apiOf = (create: jest.Mock) =>
	({ expenses: { create } }) as never as RetrospendClient;

describe("the entry sender's version", () => {
	it("returns the expense's updatedAt from the create answer", async () => {
		const create = jest.fn(async () => ({
			undo: "tok",
			expense: { updatedAt: "2026-10-15T15:00:01.000Z" },
		}));
		expect(await createEntrySender(apiOf(create))(entry("expenses"))).toEqual({
			status: "sent",
			version: "2026-10-15T15:00:01.000Z",
		});
	});

	it("names no version for a create whose answer was lost (id taken)", async () => {
		const create = jest.fn(async () => {
			throw Object.assign(new Error("taken"), {
				status: 409,
				code: "id_taken",
			});
		});
		expect(await createEntrySender(apiOf(create))(entry("expenses"))).toEqual({
			status: "sent",
		});
	});
});
