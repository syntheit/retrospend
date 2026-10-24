import { createReadCache } from "./cache";
import { createOutbox, type NewOutboxEntry } from "./outbox";
import { createMemoryStore } from "./store";
import { flushOutbox } from "./sync";

const create = (id: string): NewOutboxEntry => ({
	clientId: id,
	entity: "expenses",
	kind: "create",
	targetId: id,
	baseVersion: null,
	payload: { title: id },
});

describe("read cache", () => {
	it("returns what it wrote and drops other schema versions", async () => {
		const cache = createReadCache(createMemoryStore(), "acct");
		await cache.write("categories", 1, [{ id: "a" }], "2026-10-24T10:00:00Z");
		expect(await cache.read("categories", 1)).toMatchObject({
			data: [{ id: "a" }],
			serverTime: "2026-10-24T10:00:00Z",
		});
		expect(await cache.read("categories", 2)).toBeNull();
		expect(await cache.read("categories", 1)).toBeNull();
	});

	it("keeps accounts apart and clears one on sign out", async () => {
		const store = createMemoryStore();
		const a = createReadCache(store, "a");
		const b = createReadCache(store, "b");
		await a.write("x", 1, "from a");
		await b.write("x", 1, "from b");
		await a.clear();
		expect(await a.read("x", 1)).toBeNull();
		expect((await b.read("x", 1))?.data).toBe("from b");
	});

	it("treats a corrupt entry as a miss", async () => {
		const store = createMemoryStore();
		await store.set("cache:a:x", "{not json");
		expect(await createReadCache(store, "a").read("x", 1)).toBeNull();
	});
});

describe("outbox", () => {
	it("keeps insertion order, even with the same millisecond", async () => {
		const outbox = createOutbox(createMemoryStore(), "a", () => new Date(0));
		await Promise.all(["c", "a", "b"].map((id) => outbox.enqueue(create(id))));
		const ids = (await outbox.pending()).map((e) => e.clientId);
		expect(ids).toEqual(["c", "a", "b"]);
	});

	it("flushes in order, parks conflicts and stops at a retry", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		for (const id of ["one", "two", "three", "four"]) {
			await outbox.enqueue(create(id));
		}
		const seen: string[] = [];
		const report = await flushOutbox(outbox, async (entry) => {
			seen.push(entry.clientId);
			if (entry.clientId === "two")
				return { status: "conflict", reason: "newer" };
			if (entry.clientId === "three")
				return { status: "retry", reason: "offline" };
			return { status: "sent" };
		});
		expect(seen).toEqual(["one", "two", "three"]);
		expect(report).toEqual({ sent: 1, conflicts: 1, stopped: true });
		const all = await outbox.all();
		expect(all.map((e) => [e.clientId, e.state])).toEqual([
			["two", "conflict"],
			["three", "failed"],
			["four", "pending"],
		]);
		expect(all[1]?.attempts).toBe(1);
		// Parked conflicts are not retried.
		expect((await outbox.pending()).map((e) => e.clientId)).toEqual([
			"three",
			"four",
		]);
	});

	it("turns a throwing sender into a retry", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("x"));
		const report = await flushOutbox(outbox, async () => {
			throw new Error("network");
		});
		expect(report.stopped).toBe(true);
		expect((await outbox.all())[0]?.lastError).toContain("network");
	});
});
