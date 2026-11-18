import { captureSent, engineFor } from "@/data/device-engine";
import { runBulk } from "@/features/activity/bulkWrite";
import { expense, fakeDeviceApi } from "../../../test/deviceApi";
import { runDelete } from "./deleteEntry";
import { saveExpenseEdit } from "./edit";
import { undoWrite } from "./send";

// A create the phone captured is compared after the next pull, unless the
// phone itself changed the row first: an edit, a delete or a bulk write then
// makes the synced row differ from what the create booked, so the capture is
// forgotten before the request goes (an answer that gets lost changes nothing).
// Undoing the create removes the row, so its capture goes too: left to time
// out it would be logged as expired, a false signal.

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
const row = (id: string) => ({
	...expense(id, "100", "2026-10-05T03:00:00.000Z"),
	currency: "USD",
	amountInUSD: "100",
	exchangeRate: "1",
	rateType: "blue",
	homeRate: "1545",
	homeAmount: "154500.00",
});

/** An engine that has pulled rows e1 and e2, both captured as created a second ago. */
async function captured() {
	jest.spyOn(console, "warn").mockImplementation(() => {});
	const { client } = fakeDeviceApi({
		rates,
		expenses: [
			{
				items: [row("e1"), row("e2")],
				tombstones: [],
				cursor: "c1",
				hasMore: false,
			},
		],
	});
	const engine = engineFor(client, "u1");
	await engine.pull();
	for (const id of ["e1", "e2"])
		captureSent(
			client,
			{
				clientId: id,
				entity: "expenses",
				payload: { amount: "100", currency: "USD", date: "2026-10-05" },
			},
			Date.now() - 1000,
		);
	return { client, engine };
}

beforeEach(() => {
	process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE = "1";
});
afterEach(() => {
	jest.useRealTimers();
	delete process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE;
	jest.restoreAllMocks();
});

describe("a create the phone then changes", () => {
	it("is compared when nothing touched it (control)", async () => {
		const { engine } = await captured();
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 2 });
	});

	it("is not compared after an edit, even one that got no answer", async () => {
		const { client, engine } = await captured();
		Object.assign(client, {
			expenses: {
				update: async () => {
					throw new Error("offline");
				},
			},
		});
		const out = await saveExpenseEdit(
			client,
			{ entity: "expenses", label: "x", body: { id: "e1" } } as never,
			"key",
		);
		expect(out.status).toBe("offline");
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 1 });
	});

	it("is not compared after a delete, of a plain or a split expense", async () => {
		const { client, engine } = await captured();
		Object.assign(client, {
			expenses: { delete: async () => ({ undo: "t" }) },
			"shared-expenses": { delete: async () => ({ undo: "t" }) },
		});
		await runDelete(client, { id: "e1", shared: false }, "k1");
		await runDelete(client, { id: "e2", shared: true }, "k2");
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({});
	});

	it("is not compared after a bulk category change or bulk delete of it", async () => {
		const { client, engine } = await captured();
		const expenses = {
			bulkCategory: async () => ({ updated: 1, undo: "t" }),
			bulkDelete: async () => ({ deleted: 1, skipped: [], undo: "t" }),
		};
		Object.assign(client, { expenses });
		await runBulk(
			client,
			{ kind: "category", categoryId: "c", name: "n" },
			["e1"],
			"b1",
		);
		await runBulk(client, { kind: "delete" }, ["e2"], "b2");
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({});
	});

	it("is dropped by an undo of the create, so it is never counted as expired", async () => {
		const { client, engine } = await captured();
		await engine.pull();
		// The row of e3 never reaches the phone: the create was undone first.
		captureSent(
			client,
			{
				clientId: "e3",
				entity: "expenses",
				payload: { amount: "100", currency: "USD", date: "2026-10-05" },
			},
			Date.now() - 1000,
		);
		Object.assign(client, {
			expenses: { undo: async () => ({ undone: true }) },
		});
		await undoWrite(client, { entity: "expenses", token: "t" }, "e3");
		jest.useFakeTimers({ now: Date.now() + 11 * 60_000 });
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({ match: 2 });
	});
});
