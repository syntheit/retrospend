import { describe, expect, it, vi } from "vitest";
import type { WriteOp } from "./book";
import { createDeviceEngine } from "./engine";
import { cursor, fakeDeviceApi, template } from "./fake-api";
import type { PendingEntry, PendingSource, TemplateChange } from "./pending";
import type { ServerPreview } from "./preview-compare";

// A person's template create or edit booked on the device. Home is ARS in
// Buenos Aires (UTC-3), the pulled template t1 is USD 20 monthly due
// 2026-12-01T03:00Z at version 2026-11-18T10:00Z. By hand:
//   a create of "Gym" for USD 30 due 2026-12-15 is stored as the start of
//   Dec 15 there (2026-12-15T03:00:00.000Z) anchored on 15, auto-pay as
//   asked, and has no version until the server answers;
//   a pause writes isActive false and nothing else; a due date of
//   2026-12-20 moves the due instant to 2026-12-20T03:00:00.000Z and the
//   anchor to 20.
const NOW = Date.parse("2026-12-01T03:05:00.000Z");
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});
const create = (over: Record<string, unknown> = {}): WriteOp => ({
	kind: "templateCreate",
	body: {
		id: "t2",
		name: "Gym",
		amount: "30",
		currency: "USD",
		frequency: "MONTHLY",
		nextDueDate: "2026-12-15",
		autoPay: false,
		...over,
	},
});
const edit = (body: Record<string, unknown>): WriteOp => ({
	kind: "templateUpdate",
	body: { id: "t1", ...body },
});

class Pending implements PendingSource {
	entries = (): PendingEntry[] => [];
	retire() {}
	takeLeft = () => [];
}

async function setup(row = template("t1")) {
	const { api } = fakeDeviceApi({
		expenses: [page([])],
		transfers: [page([])],
		templates: [page([row])],
	});
	const engine = createDeviceEngine(api, "u1", () => NOW, {
		pending: new Pending(),
		warn: vi.fn(),
	});
	await engine.pull();
	return engine;
}

const after = (booked: { changes: unknown[] } | null) =>
	(booked?.changes[0] as TemplateChange | undefined)?.after;

describe("DeviceEngine.book of a template create or edit", () => {
	it("books a new template under the client id in the saved zone, with no version and no text", async () => {
		const booked = await (await setup()).book(create());
		expect(booked?.base).toBeNull();
		expect(booked?.changes).toHaveLength(1);
		expect(booked?.changes[0]).toMatchObject({
			table: "recurringTemplates",
			id: "t2",
			before: null,
		});
		expect(after(booked)).toMatchObject({
			nextDueDate: new Date("2026-12-15T03:00:00.000Z"),
			anchorDay: 15,
			autoPay: false,
			isActive: true,
			version: null,
		});
		expect(JSON.stringify(booked)).not.toContain("Gym");
	});

	it("books a pause as the template's own flag, based on the pulled version", async () => {
		const booked = await (await setup()).book(edit({ paused: true }));
		expect(booked?.base).toBe("2026-11-18T10:00:00.000Z");
		expect(after(booked)).toMatchObject({ isActive: false, amount: "20" });
		// An edit that names nothing changes nothing.
		expect(await (await setup()).book(edit({}))).toMatchObject({
			changes: [],
		});
	});

	it("books a new due date as the due instant and the anchor", async () => {
		const booked = await (
			await setup()
		).book(edit({ nextDueDate: "2026-12-20" }));
		expect(after(booked)).toMatchObject({
			nextDueDate: new Date("2026-12-20T03:00:00.000Z"),
			anchorDay: 20,
		});
	});

	it("is null, a refusal the server decides, for a taken id, a bad amount and a template that is not there", async () => {
		const engine = await setup();
		expect(await engine.book(create({ id: "t1" }))).toBeNull();
		expect(await engine.book(create({ amount: "1,5" }))).toBeNull();
		expect(await engine.book(edit({ name: "" }))).toBeNull();
		expect(
			await engine.book({
				kind: "templateUpdate",
				body: { id: "nope", paused: true },
			}),
		).toBeNull();
	});
});

describe("DeviceEngine.comparePreview of a template create", () => {
	it("is held against the server's dry run of the same body", async () => {
		const engine = await setup();
		const server: ServerPreview = {
			changes: [],
			unchanged: [],
			unavailable: [],
		};
		const verdict = await engine.comparePreview(create(), server);
		expect(verdict?.id).toBe("t2");
	});
});
