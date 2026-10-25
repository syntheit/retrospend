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
	it("counts a send before it leaves and keeps network and server failures apart", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("x"));
		expect((await outbox.all())[0]).toMatchObject({
			attempts: 0,
			networkFailures: 0,
			serverErrors: 0,
		});
		await outbox.markSending("x");
		expect((await outbox.all())[0]).toMatchObject({
			state: "sending",
			attempts: 1,
		});
		await outbox.markFailed("x", "offline");
		await outbox.markFailed("x", "boom", "server");
		expect((await outbox.all())[0]).toMatchObject({
			state: "failed",
			attempts: 1,
			networkFailures: 1,
			serverErrors: 1,
		});
		// A send that began and has no answer yet is still sent again later.
		await outbox.markSending("x");
		expect((await outbox.pending()).map((e) => e.state)).toEqual(["sending"]);
	});

	it("puts a parked entry back in line", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("x"));
		await outbox.markConflict("x", "forbidden");
		expect(await outbox.pending()).toEqual([]);
		await outbox.requeue("x");
		expect((await outbox.pending())[0]).toMatchObject({
			clientId: "x",
			state: "pending",
			lastError: null,
		});
	});

	it("discards one entry and leaves the rest", async () => {
		const outbox = createOutbox(createMemoryStore(), "a");
		await outbox.enqueue(create("one"));
		await outbox.enqueue(create("two"));
		await outbox.discard("one");
		expect((await outbox.all()).map((e) => e.clientId)).toEqual(["two"]);
		await outbox.discard("missing");
		expect(await outbox.all()).toHaveLength(1);
	});
});
