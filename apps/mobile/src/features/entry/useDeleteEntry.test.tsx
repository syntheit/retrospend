import type { RetrospendClient } from "@retrospend/api-client";
import { Alert, type AlertButton } from "react-native";
import type { DeviceWrites } from "@/data/device-engine";
import { act, lastToast, renderHook, world } from "../../../test/harness";
import { useDeleteEntry } from "./useDeleteEntry";

// Deleting a synced expense under the dev flag: it is queued on the version the
// screen read, or on the one the device last pulled when the read fails (the
// phone is offline). Nothing guesses a version.

const ID = "6f1d1c1e-5b0e-4f5c-9c33-0a4a1c0f8a11";
const PULLED = "2026-10-05T03:00:00.000Z";
const SERVER = "2026-10-06T09:00:00.000Z";

const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({
	deviceWrites: () => mockWrites(),
}));
/** Flag off: the one door answers null, as it does in a build without the engine. */
const flagOff = () => mockWrites.mockReturnValue(null);

const diff = { changes: [], unchanged: [], unavailable: [] };

function writesBase(base: string | null): DeviceWrites {
	return {
		book: async () => ({ bookedAt: 1, changes: [], changed: [], base }),
		comparePreview: async () => undefined,
		pullsBegun: () => 1,
		storedRebase: async () => null,
		absentSince: async () => false,
		refresh: async () => undefined,
	};
}

/** Offline: every call fails like a phone with no network, the dry run too. */
function client(read: "online" | "offline") {
	const down = async () => {
		throw new Error("Network request failed");
	};
	return {
		expenses: {
			previewDelete: read === "offline" ? down : async () => diff,
			get: read === "offline" ? down : async () => ({ updatedAt: SERVER }),
		},
		"shared-expenses": { previewDelete: down },
	} as unknown as RetrospendClient;
}

let alert: jest.SpyInstance;
beforeEach(() => {
	mockWrites.mockReset();
	flagOff();
	alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

async function remove(onDeleted = jest.fn()) {
	const hook = await renderHook(() => useDeleteEntry());
	await act(async () => {
		hook.result.current({ id: ID, shared: false, title: "Lunch", onDeleted });
	});
	const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
	const destructive = buttons.find((b) => b.style === "destructive");
	await act(async () => {
		await destructive?.onPress?.();
	});
	return onDeleted;
}

describe("a queued delete under the device flag", () => {
	it("is based on the version the server read gave, when it answers", async () => {
		world.api = client("online");
		mockWrites.mockReturnValue(writesBase(PULLED));
		await remove();
		const [entry] = await world.local.outbox.all();
		expect(entry).toMatchObject({ kind: "delete", baseVersion: SERVER });
	});

	it("queues offline on the version the device last pulled", async () => {
		world.api = client("offline");
		mockWrites.mockReturnValue(writesBase(PULLED));
		const onDeleted = await remove();
		const [entry] = await world.local.outbox.all();
		expect(entry).toMatchObject({
			kind: "delete",
			targetId: ID,
			baseVersion: PULLED,
		});
		expect(lastToast().message).toBe("Deleted Lunch");
		expect(onDeleted).toHaveBeenCalled();
	});

	it("reaches the confirm in airplane mode and queues on the pulled version", async () => {
		world.api = client("offline");
		mockWrites.mockReturnValue(writesBase(PULLED));
		await remove();
		const [entry] = await world.local.outbox.all();
		expect(entry).toMatchObject({ kind: "delete", baseVersion: PULLED });
		expect(alert.mock.calls.at(-1)?.[0]).toBe("Delete expense?");
		expect(alert.mock.calls.at(-1)?.[1]).toBeUndefined();
	});

	it("stops with the failure toast when the dry run is refused", async () => {
		world.api = {
			expenses: {
				previewDelete: async () => {
					throw Object.assign(new Error("no"), { status: 403 });
				},
			},
		} as unknown as RetrospendClient;
		mockWrites.mockReturnValue(writesBase(PULLED));
		const hook = await renderHook(() => useDeleteEntry());
		await act(async () => {
			hook.result.current({ id: ID, shared: false, title: "Lunch" });
		});
		expect(alert).not.toHaveBeenCalled();
		expect(lastToast().message).toBe("Couldn't delete this. Try again.");
		expect(await world.local.outbox.all()).toEqual([]);
	});

	it("a shared expense offline gets the failure toast and no alert, flag on", async () => {
		world.api = client("offline");
		mockWrites.mockReturnValue(writesBase(PULLED));
		const hook = await renderHook(() => useDeleteEntry());
		await act(async () => {
			hook.result.current({ id: ID, shared: true, title: "Dinner" });
		});
		expect(alert).not.toHaveBeenCalled();
		expect(lastToast().message).toBe("Couldn't delete this. Try again.");
		expect(await world.local.outbox.all()).toEqual([]);
	});

	it("an expense offline gets the failure toast and no alert, flag off", async () => {
		world.api = client("offline");
		flagOff();
		const hook = await renderHook(() => useDeleteEntry());
		await act(async () => {
			hook.result.current({ id: ID, shared: false, title: "Lunch" });
		});
		expect(alert).not.toHaveBeenCalled();
		expect(lastToast().message).toBe("Couldn't delete this. Try again.");
		expect(await world.local.outbox.all()).toEqual([]);
	});

	it("is refused, queuing nothing, when no version can be read", async () => {
		world.api = client("offline");
		mockWrites.mockReturnValue(writesBase(null));
		const onDeleted = await remove();
		expect(await world.local.outbox.all()).toEqual([]);
		expect(lastToast().message).toBe(
			"Couldn't read this expense. Try again in a moment.",
		);
		expect(onDeleted).not.toHaveBeenCalled();
	});

	it("says it is still sending only when a send of the row began", async () => {
		world.api = client("offline");
		mockWrites.mockReturnValue(writesBase(PULLED));
		await world.local.outbox.enqueue({
			clientId: "c1",
			entity: "expenses",
			kind: "create",
			targetId: ID,
			baseVersion: null,
			payload: { id: ID },
		});
		// An unsent create: the delete chains after it and says nothing of sending.
		await remove();
		expect(lastToast().message).not.toContain("still sending");
		expect(await world.local.outbox.all()).toHaveLength(2);
		const [, queuedDelete] = await world.local.outbox.all();
		await world.local.outbox.markSending(String(queuedDelete?.clientId));
		await remove();
		expect(lastToast().message).toBe(
			"This expense is still sending. Try again in a moment.",
		);
		expect(await world.local.outbox.all()).toHaveLength(2);
	});
});
