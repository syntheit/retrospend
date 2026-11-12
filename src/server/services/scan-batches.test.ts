import { describe, expect, it } from "vitest";
import { insideTransaction } from "~/server/db-tx";
import { readInChunks, type ScanClient, scanBatches } from "./scan-batches";

/** A client whose transactions only count themselves. */
function fakeClient() {
	const opened = { n: 0 };
	const db = {
		$transaction: (work: (tx: unknown) => Promise<unknown>) => {
			opened.n++;
			return work({ $executeRaw: async () => 0 });
		},
	} as unknown as ScanClient;
	return { db, opened };
}

const ROWS = [10, 9, 8, 7, 6, 5, 4];

/** Rows below `after`, newest first, as a keyset read gives them. */
const read = async (_tx: unknown, after: number | null, take: number) =>
	ROWS.filter((r) => after === null || r < after).slice(0, take);

describe("scanBatches", () => {
	it("reads every batch, one transaction each, until a short one", async () => {
		const { db, opened } = fakeClient();
		const seen: number[][] = [];
		await scanBatches(db, "u1", {
			batch: 3,
			start: null,
			read,
			cursorOf: (r) => r,
			visit: (rows) => {
				seen.push(rows);
				return false;
			},
		});
		expect(seen).toEqual([[10, 9, 8], [7, 6, 5], [4]]);
		expect(opened.n).toBe(3);
	});

	it("starts after the cursor and stops when visit says so", async () => {
		const { db, opened } = fakeClient();
		const seen: number[] = [];
		await scanBatches(db, "u1", {
			batch: 2,
			start: 9,
			read,
			cursorOf: (r) => r,
			visit: (rows) => {
				seen.push(...rows);
				return seen.length >= 3;
			},
		});
		expect(seen).toEqual([8, 7, 6, 5]);
		expect(opened.n).toBe(2);
	});

	it("reads one more, empty, batch when the rows end on a full one", async () => {
		const { db, opened } = fakeClient();
		await scanBatches(db, "u1", {
			batch: 7,
			start: null,
			read,
			cursorOf: (r) => r,
			visit: () => false,
		});
		expect(opened.n).toBe(2);
	});

	it("refuses to run inside a transaction", async () => {
		const { db, opened } = fakeClient();
		await expect(
			insideTransaction(() =>
				scanBatches(db, "u1", {
					start: null,
					read,
					cursorOf: (r) => r,
					visit: () => false,
				}),
			),
		).rejects.toThrow(/outside one/);
		expect(opened.n).toBe(0);
	});
});

describe("readInChunks", () => {
	it("reads the ids in chunks of at most the size, in order", async () => {
		const calls: string[][] = [];
		const out = await readInChunks(["a", "b", "c", "d", "e"], 2, async (ids) => {
			calls.push(ids);
			return ids.map((id) => id.toUpperCase());
		});
		expect(calls).toEqual([["a", "b"], ["c", "d"], ["e"]]);
		expect(out).toEqual(["A", "B", "C", "D", "E"]);
	});
});
