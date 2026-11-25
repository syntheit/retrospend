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

const diff = { changes: [], unchanged: [], unavailable: [] };

function writesBase(base: string | null): DeviceWrites {
	return {
		book: async () => ({ bookedAt: 1, changes: [], changed: [], base }),
		comparePreview: async () => undefined,
		pullsBegun: () => 1,
		refresh: async () => undefined,
	};
}

/** `get` answers with the server's row, or fails like a phone with no network. */
function client(read: "online" | "offline") {
	return {
		expenses: {
			previewDelete: async () => diff,
			get: async () => {
				if (read === "offline") throw new Error("Network request failed");
				return { updatedAt: SERVER };
			},
		},
	} as unknown as RetrospendClient;
}

let alert: jest.SpyInstance;
beforeEach(() => {
	mockWrites.mockReset();
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
