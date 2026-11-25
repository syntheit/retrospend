import {
	type BulkDevice,
	bulkDevice,
	previewBulk,
	runBulk,
	SyncFirstError,
	skippedOf,
	undoBulk,
	unsyncedIds,
} from "./bulkWrite";

const empty = { changes: [], unchanged: [], unavailable: [] };

function fakeApi(over: Record<string, unknown> = {}) {
	const api = {
		expenses: {
			previewBulkDelete: jest.fn(async ({ ids }: { ids: string[] }) => ({
				...empty,
				detail: {
					kind: "expense.deleteMany",
					deleted: ids.length,
					skipped: [],
				},
			})),
			previewBulkCategory: jest.fn(async () => empty),
			bulkDelete: jest.fn(async ({ ids }: { ids: string[] }) => ({
				deleted: ids.length - 1,
				skipped: [ids[ids.length - 1]],
				undo: "tok-del",
			})),
			bulkCategory: jest.fn(async (body: { ids: string[] }) => ({
				updated: body.ids.length,
				undo: "tok-cat",
			})),
			undo: jest.fn(async () => ({ id: null, redo: "r" })),
			...over,
		},
	};
	return { api: api as never, raw: api };
}

describe("previewBulk", () => {
	it("dry-runs the whole delete in one request", async () => {
		const { api, raw } = fakeApi();
		const state = await previewBulk(api, { kind: "delete" }, ["a", "b"]);
		expect(state.status).toBe("ready");
		expect(raw.expenses.previewBulkDelete).toHaveBeenCalledTimes(1);
		expect(raw.expenses.previewBulkDelete).toHaveBeenCalledWith(
			{ ids: ["a", "b"] },
			expect.anything(),
		);
	});

	it("reads no answer from the server as offline", async () => {
		const { api } = fakeApi({
			previewBulkCategory: jest.fn(async () => {
				throw new Error("network");
			}),
		});
		const state = await previewBulk(
			api,
			{ kind: "category", categoryId: "c", name: "Food" },
			["a"],
		);
		expect(state.status).toBe("offline");
	});

	it("reads a 4xx as refused", async () => {
		const { api } = fakeApi({
			previewBulkDelete: jest.fn(async () => {
				throw Object.assign(new Error("no"), { status: 400 });
			}),
		});
		const state = await previewBulk(api, { kind: "delete" }, ["a"]);
		expect(state.status).toBe("refused");
	});
});

describe("skippedOf", () => {
	it("counts the ids a delete would skip, and nothing for another write", () => {
		expect(
			skippedOf({
				...empty,
				detail: { kind: "expense.deleteMany", deleted: 1, skipped: ["x"] },
			}),
		).toBe(1);
		expect(skippedOf(empty)).toBe(0);
	});
});

describe("runBulk", () => {
	it("moves the expenses in one request and keeps the one token", async () => {
		const { api, raw } = fakeApi();
		const out = await runBulk(
			api,
			{ kind: "category", categoryId: "c", name: "Food" },
			["a", "b"],
			"k1",
		);
		expect(out).toEqual({ done: 2, failed: 0, tokens: ["tok-cat"] });
		expect(raw.expenses.bulkCategory).toHaveBeenCalledWith(
			{ ids: ["a", "b"], categoryId: "c" },
			{ context: { idempotencyKey: "k1" } },
		);
	});

	it("deletes in one request with one key and one token, counting the skipped", async () => {
		const { api, raw } = fakeApi();
		const out = await runBulk(api, { kind: "delete" }, ["a", "b", "c"], "k2");
		expect(out).toEqual({ done: 2, failed: 1, tokens: ["tok-del"] });
		expect(raw.expenses.bulkDelete).toHaveBeenCalledTimes(1);
		expect(raw.expenses.bulkDelete).toHaveBeenCalledWith(
			{ ids: ["a", "b", "c"] },
			{ context: { idempotencyKey: "k2" } },
		);
	});
});

describe("undoBulk", () => {
	it("sends every token with its own key", async () => {
		const { api, raw } = fakeApi();
		expect(await undoBulk(api, ["t1", "t2"], "k3")).toBe(true);
		expect(raw.expenses.undo).toHaveBeenCalledTimes(2);
		expect(raw.expenses.undo).toHaveBeenCalledWith(
			{ token: "t2" },
			{ context: { idempotencyKey: "k3-undo-1" } },
		);
	});

	it("says so when a token is refused, and still tries the rest", async () => {
		const undo = jest
			.fn()
			.mockRejectedValueOnce(new Error("expired"))
			.mockResolvedValue({});
		const { api } = fakeApi({ undo });
		expect(await undoBulk(api, ["t1", "t2"], "k4")).toBe(false);
		expect(undo).toHaveBeenCalledTimes(2);
	});
});

// Dev flag: the device books beside the server. ARS home, blue 1545: a, b, c
// are USD 10, income and a transfer's fee; ghost is gone. A delete takes a.
const BOOKED = {
	bookedAt: 1,
	changes: [],
	skipped: [
		{ id: "b", reason: "notFound" as const },
		{ id: "c", reason: "hasLegs" as const },
		{ id: "ghost", reason: "notFound" as const },
	],
	reached: 1,
};
const entry = (targetId: string) => ({ targetId });

function fakeDevice(
	over: { open?: unknown[]; acked?: unknown[]; booked?: unknown } = {},
) {
	const writes = {
		bookBulk: jest.fn(async () => ("booked" in over ? over.booked : BOOKED)),
		comparePreviewBulk: jest.fn(async () => undefined),
		settleBulk: jest.fn(),
		undoneBulk: jest.fn(),
	};
	const outbox = {
		snapshot: jest.fn(async () => ({
			open: over.open ?? [],
			acked: over.acked ?? [],
		})),
		enqueue: jest.fn(),
	};
	return {
		device: { writes, outbox } as unknown as BulkDevice,
		writes,
		outbox,
	};
}

const PICKED = ["a", "b", "c", "ghost"];

describe("bulk under the device flag", () => {
	it("acked-not-pulled id refuses Sync first", async () => {
		const { api, raw } = fakeApi();
		const { device, writes } = fakeDevice({ acked: [entry("c")] });
		await expect(
			runBulk(api, { kind: "delete" }, PICKED, "k1", device),
		).rejects.toBeInstanceOf(SyncFirstError);
		expect(raw.expenses.bulkDelete).not.toHaveBeenCalled();
		expect(writes.bookBulk).not.toHaveBeenCalled();
	});

	it("an open or parked entry for a picked id refuses Sync first, one for another id does not", async () => {
		const { device } = fakeDevice({ open: [entry("ghost")] });
		expect(await unsyncedIds(device, PICKED)).toEqual(["ghost"]);
		const other = fakeDevice({ open: [entry("zzz")], acked: [entry("yyy")] });
		expect(await unsyncedIds(other.device, PICKED)).toEqual([]);
	});

	it("a categorize refuses the same way", async () => {
		const { api, raw } = fakeApi();
		const { device } = fakeDevice({ open: [entry("a")] });
		await expect(
			runBulk(
				api,
				{ kind: "category", categoryId: "food", name: "Food" },
				PICKED,
				"k1",
				device,
			),
		).rejects.toBeInstanceOf(SyncFirstError);
		expect(raw.expenses.bulkCategory).not.toHaveBeenCalled();
	});

	it("sends at once and hands the device booking and the answer to the engine, skipped ids included", async () => {
		const { api, raw } = fakeApi();
		const { device, writes } = fakeDevice();
		const out = await runBulk(api, { kind: "delete" }, PICKED, "k1", device);
		expect(writes.bookBulk).toHaveBeenCalledWith({
			kind: "deleteMany",
			ids: PICKED,
		});
		expect(raw.expenses.bulkDelete).toHaveBeenCalledTimes(1);
		// The fake server deletes 3 and skips ghost: the answer reaches the engine as it came.
		expect(writes.settleBulk).toHaveBeenCalledWith(
			"k1",
			BOOKED,
			{ reached: 3, skipped: ["ghost"] },
			PICKED,
		);
		expect(out).toEqual({ done: 3, failed: 1, tokens: ["tok-del"] });
	});

	it("a categorize settles with the count the server updated and no skipped ids", async () => {
		const { api } = fakeApi();
		const { device, writes } = fakeDevice();
		await runBulk(
			api,
			{ kind: "category", categoryId: "hold", name: "Hold" },
			["a", "b", "c"],
			"k2",
			device,
		);
		expect(writes.bookBulk).toHaveBeenCalledWith({
			kind: "categorize",
			categoryId: "hold",
			ids: ["a", "b", "c"],
		});
		expect(writes.settleBulk).toHaveBeenCalledWith(
			"k2",
			BOOKED,
			{ reached: 3, skipped: null },
			["a", "b", "c"],
		);
	});

	it("sends when the device could not book, and settles nothing", async () => {
		const { api, raw } = fakeApi();
		const { device, writes } = fakeDevice({ booked: null });
		await runBulk(api, { kind: "delete" }, PICKED, "k1", device);
		expect(raw.expenses.bulkDelete).toHaveBeenCalledTimes(1);
		expect(writes.settleBulk).not.toHaveBeenCalled();
	});

	it("an engine that throws never turns a write the server took into an error", async () => {
		const { api } = fakeApi();
		const { device, writes } = fakeDevice();
		writes.settleBulk.mockImplementation(() => {
			throw new Error("engine");
		});
		const out = await runBulk(api, { kind: "delete" }, PICKED, "k1", device);
		expect(out.done).toBe(3);
	});

	it("is online only: no answer fails the write, settles nothing and queues nothing", async () => {
		const { api } = fakeApi({
			bulkDelete: jest.fn(async () => {
				throw new Error("network");
			}),
		});
		const { device, writes, outbox } = fakeDevice();
		await expect(
			runBulk(api, { kind: "delete" }, PICKED, "k1", device),
		).rejects.toThrow("network");
		expect(writes.settleBulk).not.toHaveBeenCalled();
		expect(outbox.enqueue).not.toHaveBeenCalled();
	});

	it("an offline preview stays offline and holds nothing against the device", async () => {
		const { api } = fakeApi({
			previewBulkDelete: jest.fn(async () => {
				throw new Error("network");
			}),
		});
		const { device, writes } = fakeDevice();
		const state = await previewBulk(api, { kind: "delete" }, PICKED, device);
		expect(state.status).toBe("offline");
		expect(writes.comparePreviewBulk).not.toHaveBeenCalled();
	});

	it("holds the device preview against the server's when it arrives", async () => {
		const { api } = fakeApi();
		const { device, writes } = fakeDevice();
		const state = await previewBulk(api, { kind: "delete" }, PICKED, device);
		expect(state.status).toBe("ready");
		expect(writes.comparePreviewBulk).toHaveBeenCalledWith(
			{ kind: "deleteMany", ids: PICKED },
			expect.objectContaining({ changes: [] }),
		);
	});

	it("an undo takes the batch back from the engine, and a refused token leaves it", async () => {
		const { api } = fakeApi();
		const { device, writes } = fakeDevice();
		expect(await undoBulk(api, ["t"], "k1", device)).toBe(true);
		expect(writes.undoneBulk).toHaveBeenCalledWith("k1");
		writes.undoneBulk.mockClear();
		const refused = fakeApi({
			undo: jest.fn(async () => {
				throw new Error("no");
			}),
		});
		expect(await undoBulk(refused.api, ["t"], "k1", device)).toBe(false);
		expect(writes.undoneBulk).not.toHaveBeenCalled();
	});
});

describe("bulk with the flag off", () => {
	it("has no device, checks no outbox and writes exactly as before", async () => {
		const outbox = { snapshot: jest.fn() };
		const { api } = fakeApi();
		expect(bulkDevice(api, outbox as never)).toBeNull();
		const out = await runBulk(api, { kind: "delete" }, PICKED, "k1");
		expect(out).toEqual({ done: 3, failed: 1, tokens: ["tok-del"] });
		expect(outbox.snapshot).not.toHaveBeenCalled();
		expect(await undoBulk(api, ["t"], "k1")).toBe(true);
	});
});
