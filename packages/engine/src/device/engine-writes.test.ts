import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_TTL_MS, CreateCaptures } from "../create-captures";
import { compareCreate } from "../write-parity";
import { createDeviceEngine } from "./engine";
import { expense, fakeDeviceApi, SETTINGS } from "./fake-api";

vi.mock("../write-parity", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../write-parity")>();
	return { ...actual, compareCreate: vi.fn(actual.compareCreate) };
});
const actualCompare = (
	await vi.importActual<typeof import("../write-parity")>("../write-parity")
).compareCreate;

// The device engine comparing the creates the server booked. Home is ARS in
// Buenos Aires; "now" is 2026-10-15 15:00Z. The rate table (ARS blue 1545,
// stamped Oct 14 09:05Z) is older than the send, which began a minute before
// now. USD 100 on 2026-10-05 books at blue: 100 x 1545 = 154500.00, on the
// instant 2026-10-05T03:00Z (midnight in Buenos Aires, UTC-3).
const NOW = new Date("2026-10-15T15:00:00.000Z");
const SENT = NOW.getTime() - 60_000;
const rates = {
	asOf: "2026-10-14T09:05:00.000Z",
	rates: [
		{
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-10-14T00:00:00.000Z",
			unitsPerUsd: "1545",
		},
	],
};
const booked = (id: string, over: Record<string, unknown> = {}) => ({
	...expense(id, "100", "2026-10-05T03:00:00.000Z"),
	currency: "USD",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: "154500.00",
	...over,
});
const page = (items: unknown[], cursor = "c1") => ({
	items,
	tombstones: [],
	cursor,
	hasMore: false,
});
const sent = (id = "e1") => ({
	id,
	kind: "expense" as const,
	body: { amount: "100", currency: "USD", date: "2026-10-05", title: "Lunch" },
	at: SENT,
});

const warn = vi.fn<(what: string, detail?: string) => void>();
function setup(
	pages: unknown[][],
	apiOptions: Parameters<typeof fakeDeviceApi>[0] = {},
) {
	const captures = new CreateCaptures();
	const { api } = fakeDeviceApi({
		rates,
		expenses: pages.map((items, i) => page(items, `c${i}`)),
		...apiOptions,
	});
	const engine = createDeviceEngine(api, "u1", Date.now, { warn, captures });
	return { engine, captures };
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW });
	warn.mockClear();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("comparing the creates a pull brings in", () => {
	it("books a captured create in a scratch store and counts a match, once", async () => {
		const { engine, captures } = setup([[booked("e1")]]);
		await engine.pull();
		expect(captures.add(sent())).toBe(true);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
		expect(engine.writeParity.recent).toEqual([{ id: "e1", outcome: "match" }]);
		expect(captures.pending()).toEqual([]);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
	});

	it("waits for the row, and compares when a later pull brings it", async () => {
		const { engine, captures } = setup([[], [], [booked("e1")]]);
		await engine.pull();
		captures.add(sent());
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({});
		expect(captures.pending()).toHaveLength(1);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
	});

	it("logs a differing field by id and name, with no amount", async () => {
		const { engine, captures } = setup([
			[booked("e1", { homeAmount: "154000.00" })],
		]);
		await engine.pull();
		captures.add(sent());
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ differs: 1 });
		expect(warn).toHaveBeenCalledTimes(1);
		const [what, detail] = warn.mock.calls[0] ?? [];
		expect(what).toBe("writes differ from the server");
		expect(JSON.parse(detail ?? "")).toMatchObject({
			checked: 1,
			findings: [{ id: "e1", outcome: "differs", fields: ["homeAmount"] }],
		});
		expect(detail).not.toMatch(/154000|154500|100|Lunch/);
	});

	it("counts a skip by code and says so quietly", async () => {
		const { engine, captures } = setup([[booked("e1")]]);
		await engine.pull();
		captures.add({
			...sent(),
			body: { ...sent().body, amortizeOver: 3 },
		});
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ "skipped:spread": 1 });
		expect(warn.mock.calls[0]?.[0]).toBe("writes checked");
	});

	it("compares a transfer on the next pull, without waiting for a row", async () => {
		const { engine, captures } = setup([[]]);
		await engine.pull();
		captures.add({ id: "t1", kind: "transfer", body: {}, at: SENT });
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ "skipped:transfer": 1 });
	});

	it("drops a create whose row never came, and counts it expired", async () => {
		const { engine, captures } = setup([[]]);
		await engine.pull();
		captures.add(sent());
		vi.setSystemTime(SENT + CAPTURE_TTL_MS + 1);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ expired: 1 });
		expect(captures.pending()).toEqual([]);
	});

	it("reports a comparison that throws as refused and keeps the pull", async () => {
		vi.mocked(compareCreate).mockRejectedValueOnce(new Error("boom 154500"));
		const { engine, captures } = setup([[booked("e1")]]);
		await engine.pull();
		captures.add(sent());
		await engine.pull();
		expect(engine.status).toBe("ready");
		expect(engine.writeParity.counts).toEqual({ refused: 1 });
		expect(warn.mock.calls[0]?.[1]).not.toContain("boom");
		vi.mocked(compareCreate).mockImplementation(actualCompare);
	});

	it("keeps the latest verdicts only", async () => {
		const rows = Array.from({ length: 101 }, (_, i) => booked(`e${i}`));
		const { engine, captures } = setup([rows]);
		await engine.pull();
		for (let i = 0; i < 101; i += 1) {
			captures.add(sent(`e${i}`));
			await engine.pull();
		}
		expect(engine.writeParity.counts.match).toBe(101);
		expect(engine.writeParity.recent).toHaveLength(100);
		expect(engine.writeParity.recent[0]?.id).toBe("e1");
	});

	it("compares nothing after a pull that failed, and keeps the create for the next one", async () => {
		const { engine, captures } = setup([[booked("e1")]], {
			fail: { route: "expenses", pull: 3, error: new Error("offline") },
		});
		await engine.pull();
		await engine.pull();
		captures.add(sent());
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({});
		expect(captures.pending()).toHaveLength(1);
	});

	it("does nothing without captures", async () => {
		const { api } = fakeDeviceApi({ rates, expenses: [page([booked("e1")])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		expect(engine.writeParity).toEqual({ counts: {}, recent: [] });
		expect(warn).not.toHaveBeenCalled();
	});

	it("captures the zone of the settings the device held when it was sent", async () => {
		const { engine, captures } = setup([[booked("e1")]], {
			settings: { ...SETTINGS, timeZone: "Asia/Tokyo" },
		});
		await engine.pull();
		captures.add(sent());
		expect(captures.pending()[0]?.zone).toBe("Asia/Tokyo");
	});
});
