import type { RetrospendClient } from "@retrospend/api-client";
import { announceEntryChange } from "@/features/entry/events";
import { flushEntries, saveEntry } from "@/features/entry/queue";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import { act, flush, renderHook, world } from "../../../test/harness";
import type { ActivityItem } from "./source";
import { usePendingRows } from "./usePending";

// The one place the lists get their waiting rows: an entry written offline
// shows at once, stays on screen when it is sent until the list has the
// server's row, and is gone when it is deleted or parked.

jest.mock("./useCategories", () => {
	const value = {
		state: {
			status: "ready",
			data: [{ id: "food", name: "Food", icon: null, tone: 3 }],
		},
		reload: async () => {},
	};
	return { useCategories: () => value };
});

const body = {
	id: "e1",
	title: "Coffee",
	amount: "3.50",
	currency: "USD",
	date: "2026-11-02",
	categoryId: "food",
};

function offlineApi(): RetrospendClient {
	const down = async () => {
		throw new Error("Network request failed");
	};
	return {
		expenses: { create: down },
		"shared-expenses": { create: down },
		income: { create: down },
		transfers: { create: down },
	} as unknown as RetrospendClient;
}

function onlineApi(): RetrospendClient {
	const ok = async () => ({ undo: "tok" });
	return {
		expenses: { create: ok },
		"shared-expenses": { create: ok },
		income: { create: ok },
		transfers: { create: ok },
	} as unknown as RetrospendClient;
}

beforeEach(() => {
	forgetSent();
	forgetUndoTokens();
});

describe("waiting rows for the lists", () => {
	it("shows an entry saved offline at once, marked not synced", async () => {
		world.api = offlineApi();
		const hook = await renderHook(() => usePendingRows(null));
		expect(hook.result.current).toEqual([]);

		await act(async () => {
			await saveEntry({
				outbox: world.local.outbox,
				api: world.api as RetrospendClient,
				write: { entity: "expenses", label: "Coffee", body },
				waitMs: 20,
			});
			announceEntryChange();
		});
		await flush();

		expect(hook.result.current).toHaveLength(1);
		expect(hook.result.current[0]).toMatchObject({
			id: "e1",
			title: "Coffee",
			unsynced: true,
			category: { name: "Food" },
		});
	});

	it("keeps the sent row, no longer marked, until the list reads the server's", async () => {
		world.api = offlineApi();
		const hook = await renderHook<ActivityItem[], string>(
			(settled) => usePendingRows(settled),
			"page-1",
		);
		await act(async () => {
			await saveEntry({
				outbox: world.local.outbox,
				api: world.api as RetrospendClient,
				write: { entity: "expenses", label: "Coffee", body },
				waitMs: 20,
			});
			announceEntryChange();
		});
		await flush();
		expect(hook.result.current[0]?.unsynced).toBe(true);

		// The network is back: the next flush sends it and it leaves the outbox.
		await act(async () => {
			await flushEntries(world.local.outbox, onlineApi());
			announceEntryChange();
		});
		await flush();
		expect(await world.local.outbox.all()).toEqual([]);
		// Same row, same place: only the mark is gone, so nothing jumps.
		expect(hook.result.current).toHaveLength(1);
		expect(hook.result.current[0]).toMatchObject({ id: "e1", unsynced: false });

		// The list's read lands with the server's row: the held copy lets go.
		await hook.rerender("page-2");
		await flush();
		expect(hook.result.current).toEqual([]);
	});

	it("drops a deleted entry from the rows", async () => {
		world.api = offlineApi();
		await world.local.outbox.enqueue({
			clientId: "e1",
			entity: "expenses",
			kind: "create",
			targetId: "e1",
			baseVersion: null,
			payload: body,
		});
		const hook = await renderHook(() => usePendingRows(null));
		await flush();
		expect(hook.result.current.map((r) => r.id)).toEqual(["e1"]);

		await act(async () => {
			await world.local.outbox.discard("e1");
			announceEntryChange();
		});
		await flush();
		expect(hook.result.current).toEqual([]);
	});

	it("leaves a parked entry to Couldn't sync", async () => {
		await world.local.outbox.enqueue({
			clientId: "e1",
			entity: "expenses",
			kind: "create",
			targetId: "e1",
			baseVersion: null,
			payload: body,
		});
		await world.local.outbox.markConflict("e1", "validation_failed");
		const hook = await renderHook(() => usePendingRows(null));
		await flush();
		expect(hook.result.current).toEqual([]);
	});
});
