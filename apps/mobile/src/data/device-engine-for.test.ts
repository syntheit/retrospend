import { expense, fakeDeviceApi } from "../../test/deviceApi";
import { captureSent, createDeviceEngine, engineFor } from "./device-engine";

describe("engineFor", () => {
	it("keeps one engine per client and account", () => {
		const { client } = fakeDeviceApi();
		const mine = engineFor(client, "u1");
		expect(engineFor(client, "u1")).toBe(mine);
		expect(engineFor(client, "u2")).not.toBe(mine);
		expect(engineFor(fakeDeviceApi().client, "u1")).not.toBe(mine);
	});
});

describe("createDeviceEngine on the phone", () => {
	it("logs the core's warnings with the engine tag", async () => {
		const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const { api } = fakeDeviceApi({
				fail: { route: "expenses", pull: 1, error: new Error("offline") },
			});
			await createDeviceEngine(api, "u1", () => 0, { warn: undefined }).pull();
			expect(spy).toHaveBeenCalledWith(
				"RetrospendDeviceEngine: pull failed",
				"Error",
			);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("captureSent", () => {
	// USD 100 on 2026-10-05 in Buenos Aires (UTC-3) at blue 1545: 154500.00.
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
	const entry = (id: string, entity: string) => ({
		clientId: id,
		entity,
		payload: {
			id,
			title: "Lunch with Zelda",
			amount: "100",
			currency: "USD",
			date: "2026-10-05",
		},
	});
	const pulled = async (rows: unknown[]) => {
		const { client } = fakeDeviceApi({
			rates,
			expenses: [{ items: rows, tombstones: [], cursor: "c1", hasMore: false }],
		});
		const engine = engineFor(client, "u1");
		await engine.pull();
		return { client, engine };
	};

	it("books a create the server accepted and finds it the same after the next pull", async () => {
		const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const { client, engine } = await pulled([row("e1")]);
			captureSent(client, entry("e1", "expenses"), Date.now() - 1000);
			await engine.pull();
			expect(engine.writeParity.counts).toEqual({ match: 1 });
			const logged = JSON.stringify(spy.mock.calls);
			expect(logged).toContain("RetrospendDeviceEngine: writes checked");
			expect(logged).not.toMatch(/Zelda|Lunch|154500/);
		} finally {
			spy.mockRestore();
		}
	});

	it("counts a split and a transfer as skipped and an income as nothing", async () => {
		jest.spyOn(console, "warn").mockImplementation(() => {});
		const { client, engine } = await pulled([row("e2"), row("i1")]);
		const at = Date.now() - 1000;
		captureSent(client, entry("e2", "shared-expenses"), at);
		captureSent(client, entry("t1", "transfers"), at);
		captureSent(client, entry("i1", "income"), at);
		await engine.pull();
		expect(engine.writeParity.counts).toEqual({
			"skipped:split": 1,
			"skipped:transfer": 1,
		});
	});

	it("does nothing for a client with no engine", () => {
		expect(() =>
			captureSent(fakeDeviceApi().client, entry("e3", "expenses"), Date.now()),
		).not.toThrow();
	});
});
