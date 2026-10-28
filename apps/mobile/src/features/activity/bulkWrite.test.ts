import { previewBulk, runBulk, skippedOf, undoBulk } from "./bulkWrite";

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
