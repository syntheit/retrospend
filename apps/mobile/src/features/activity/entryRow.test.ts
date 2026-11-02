import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { loadEntryRow, rowFromParam, stashedRow, stashRow } from "./entryRow";
import { ACTIVITY_CACHE, type ActivityItem } from "./source";

const row = (id: string, title = `Row ${id}`): ActivityItem => ({
	id,
	source: "personal",
	entityId: id,
	kind: "expense",
	title,
	category: null,
	amount: { minor: 450000, currency: "ARS" },
	sortKey: 450000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
});

const offline = async (): Promise<ActivityItem> => {
	throw new Error("offline");
};
const gone = async (): Promise<ActivityItem> => {
	throw Object.assign(new Error("not found"), { status: 404 });
};

describe("rowFromParam", () => {
	it("takes a row with the route's id", () => {
		expect(rowFromParam(JSON.stringify(row("e1")), "e1")).toEqual(row("e1"));
	});

	it("drops anything that is not a row with this id", () => {
		expect(rowFromParam("1", "x")).toBeNull();
		expect(rowFromParam("not json", "x")).toBeNull();
		expect(
			rowFromParam(JSON.stringify({ id: "x", title: "Fake" }), "x"),
		).toBeNull();
		expect(
			rowFromParam(JSON.stringify({ ...row("e1"), date: "soon" }), "e1"),
		).toBeNull();
		expect(rowFromParam(JSON.stringify(row("e1")), "e2")).toBeNull();
		expect(rowFromParam(["a"], "e1")).toBeNull();
		expect(rowFromParam(undefined, "e1")).toBeNull();
	});
});

describe("loadEntryRow", () => {
	it("reads the server's row and keeps a copy for offline", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		expect(
			await loadEntryRow("e1", async () => row("e1", "Fresh"), cache),
		).toEqual({ status: "ready", item: row("e1", "Fresh"), staleSince: null });
		const later = await loadEntryRow("e1", offline, cache);
		expect(later).toMatchObject({ status: "ready", item: row("e1", "Fresh") });
		expect(later.status === "ready" && later.staleSince).toBeTruthy();
	});

	it("says a deleted row is missing, offline too", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await loadEntryRow("e1", async () => row("e1"), cache);
		expect(await loadEntryRow("e1", gone, cache)).toEqual({
			status: "missing",
		});
		expect(await loadEntryRow("e1", offline, cache)).toEqual({
			status: "missing",
		});
	});

	it("falls back to the cached Activity page offline, else an error", async () => {
		const cache = createReadCache(createMemoryStore(), "a");
		await cache.write(ACTIVITY_CACHE.name, ACTIVITY_CACHE.schema, {
			items: [row("e2")],
		});
		expect(await loadEntryRow("e2", offline, cache)).toMatchObject({
			status: "ready",
			item: row("e2"),
		});
		expect(await loadEntryRow("e3", offline, cache)).toEqual({
			status: "error",
		});
		expect(await loadEntryRow("e3", offline, null)).toEqual({
			status: "error",
		});
	});
});

describe("stashRow", () => {
	it("gives back the row stashed for an id, and nothing for another", () => {
		const opened = row("stash-1");
		stashRow(opened);
		expect(stashedRow("stash-1")).toBe(opened);
		expect(stashedRow("stash-other")).toBeNull();
		expect(stashedRow(undefined)).toBeNull();
	});

	it("keeps the 40 newest rows", () => {
		for (let i = 0; i < 45; i++) stashRow(row(`lru-${i}`));
		expect(stashedRow("lru-0")).toBeNull();
		expect(stashedRow("lru-4")).toBeNull();
		expect(stashedRow("lru-5")?.id).toBe("lru-5");
		expect(stashedRow("lru-44")?.id).toBe("lru-44");
	});

	it("keeps a row that was opened again", () => {
		stashRow(row("again-0"));
		for (let i = 0; i < 39; i++) stashRow(row(`fill-${i}`));
		stashRow(row("again-0"));
		stashRow(row("fill-x"));
		expect(stashedRow("again-0")?.id).toBe("again-0");
	});
});
