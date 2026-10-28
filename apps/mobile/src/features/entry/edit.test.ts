import type { RetrospendClient } from "@retrospend/api-client";
import type { PendingWrite } from "./draft";
import { saveExpenseEdit } from "./edit";
import { createEntrySender, undoWrite } from "./send";

jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const write: PendingWrite = {
	entity: "expenses",
	kind: "update",
	label: "Lunch",
	body: { id: ID, title: "Lunch", amount: "10.00", currency: "USD" },
};

function apiWith(
	update: (input: unknown, options?: unknown) => Promise<unknown>,
) {
	return {
		expenses: { update, undo: jest.fn(async () => ({})) },
	} as never as RetrospendClient;
}

describe("saving an edit", () => {
	it("keeps the server's undo token for Undo", async () => {
		const update = jest.fn(async () => ({ expense: {}, undo: "tok-1" }));
		const outcome = await saveExpenseEdit(apiWith(update), write);
		expect(outcome).toEqual({
			status: "saved",
			undo: { entity: "expenses", token: "tok-1" },
		});
		expect(update).toHaveBeenCalledWith(
			write.body,
			expect.objectContaining({
				context: { idempotencyKey: "key-1" },
			}),
		);
	});

	it("reports offline when no answer came, and nothing is queued", async () => {
		const outcome = await saveExpenseEdit(
			apiWith(async () => {
				throw new TypeError("Network request failed");
			}),
			write,
		);
		expect(outcome).toEqual({ status: "offline" });
	});

	it("reports a refusal when the server read it and said no", async () => {
		const outcome = await saveExpenseEdit(
			apiWith(async () => {
				throw Object.assign(new Error("conflict"), { status: 409 });
			}),
			write,
		);
		expect(outcome).toEqual({ status: "refused" });
	});

	it("undoes through the expenses undo route", async () => {
		const api = apiWith(async () => ({}));
		await undoWrite(api, { entity: "expenses", token: "tok-1" }, "edit-1");
		expect(api.expenses.undo).toHaveBeenCalledWith(
			{ token: "tok-1" },
			expect.objectContaining({
				context: { idempotencyKey: "edit-1-undo" },
			}),
		);
	});
});

describe("a transfer in the outbox", () => {
	it("is sent to /transfers and its undo goes to the transfers route", async () => {
		const create = jest.fn(async () => ({ transfer: {}, undo: "tok-t" }));
		const undo = jest.fn(async () => ({}));
		const api = { transfers: { create, undo } } as never as RetrospendClient;
		const result = await createEntrySender(api)({
			clientId: ID,
			entity: "transfers",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: { id: ID, fromAccountId: "a", toAccountId: "b" },
			state: "pending",
			attempts: 0,
			networkFailures: 0,
			serverErrors: 0,
			lastError: null,
			createdAt: 0,
		} as never);
		expect(result).toEqual({ status: "sent" });
		expect(create).toHaveBeenCalledTimes(1);
		await undoWrite(api, { entity: "transfers", token: "tok-t" }, ID);
		expect(undo).toHaveBeenCalledWith({ token: "tok-t" }, expect.anything());
	});
});
