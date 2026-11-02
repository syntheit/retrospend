import type { RetrospendClient } from "@retrospend/api-client";
import { Alert, type AlertButton } from "react-native";
import { act, lastToast, renderHook, world } from "../../../test/harness";
import { subscribeEntryChanges } from "./events";
import { useDeletePending } from "./useDeletePending";

// Deleting an entry that only the phone has: the native alert with the
// title only, the entry leaves the outbox, and Undo puts it back in line.

const body = {
	id: "e1",
	title: "Coffee",
	amount: "3.50",
	currency: "USD",
	date: "2026-11-02",
	categoryId: "food",
};

let alert: jest.SpyInstance;
beforeEach(() => {
	alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

function enqueue() {
	return world.local.outbox.enqueue({
		clientId: "e1",
		entity: "expenses",
		kind: "create",
		targetId: "e1",
		baseVersion: null,
		payload: body,
	});
}

function confirm() {
	const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
	const destructive = buttons.find((b) => b.style === "destructive");
	return act(async () => {
		await destructive?.onPress?.();
	});
}

describe("deleting a waiting entry", () => {
	it("asks with the title only, then takes it out of the outbox", async () => {
		await enqueue();
		const changes = jest.fn();
		const off = subscribeEntryChanges(changes);
		const hook = await renderHook(() => useDeletePending());
		await act(async () => {
			hook.result.current({
				clientId: "e1",
				kind: "expense",
				title: "Coffee",
			});
		});
		expect(alert.mock.calls.at(-1)?.[0]).toBe("Delete expense?");
		expect(alert.mock.calls.at(-1)?.[1]).toBeUndefined();
		await confirm();
		expect(await world.local.outbox.all()).toEqual([]);
		expect(changes).toHaveBeenCalled();
		expect(lastToast().message).toBe("Deleted Coffee");
		off();
	});

	it("words an income and a transfer in their own title", async () => {
		const hook = await renderHook(() => useDeletePending());
		await act(async () => {
			hook.result.current({ clientId: "i1", kind: "income", title: "Salary" });
		});
		expect(alert.mock.calls.at(-1)?.[0]).toBe("Delete income?");
		await act(async () => {
			hook.result.current({
				clientId: "t1",
				kind: "transfer",
				title: "A > B",
			});
		});
		expect(alert.mock.calls.at(-1)?.[0]).toBe("Delete transfer?");
	});

	it("Undo puts the entry back in line and sends it again", async () => {
		await enqueue();
		const sent: unknown[] = [];
		world.api = {
			expenses: {
				create: async (input: unknown) => {
					sent.push(input);
					return { undo: "tok" };
				},
			},
		} as unknown as RetrospendClient;
		const hook = await renderHook(() => useDeletePending());
		await act(async () => {
			hook.result.current({ clientId: "e1", kind: "expense", title: "Coffee" });
		});
		await confirm();
		await act(async () => {
			await lastToast().undo?.onUndo();
		});
		// Back in the outbox, then sent: it is on the server, not lost.
		expect(sent).toEqual([body]);
		expect(lastToast().message).toBe("Restored Coffee");
	});

	it("says so when the entry was sent first", async () => {
		const hook = await renderHook(() => useDeletePending());
		await act(async () => {
			hook.result.current({ clientId: "gone", kind: "expense", title: "Tea" });
		});
		await confirm();
		expect(lastToast().message).toBe("Couldn't delete this. Try again.");
	});
});
