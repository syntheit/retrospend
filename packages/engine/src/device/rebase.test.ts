import { describe, expect, it } from "vitest";
import { createDeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";

// Try again on a parked edit reads the row as the last pull left it. ARS home
// in Buenos Aires (UTC-3), so a row dated 02:00Z is the evening before there.

const warn = () => undefined;
const page = (items: unknown[], tombstones: { id: string }[] = []) => ({
	items,
	tombstones,
	cursor: cursor("100"),
	hasMore: false,
});

// USD 100 at a typed rate of 1,600 ARS (ARS 160,000.00), as the server stores it.
const custom = {
	...expense("c1", "100", "2026-03-05T02:00:00.000Z"),
	currency: "USD",
	rateType: "custom",
	homeRate: "1600.000000000000",
	homeAmount: "160000.00",
	exchangeRate: "1",
	title: "Taxi",
};

describe("storedRebase", () => {
	it("keeps the typed rate and names the local day, with the pulled version", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		expect(await engine.storedRebase("c1")).toEqual({
			body: {
				id: "c1",
				title: "Taxi",
				amount: "100",
				currency: "USD",
				// 02:00Z on the 5th is 23:00 on the 4th at UTC-3.
				date: "2026-03-04",
				customRate: "1600",
				excludeFromAnalytics: false,
			},
			version: "2026-03-05T02:00:00.000Z",
		});
	});

	it("is null for a row that is not there, and before any pull", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		expect(await engine.storedRebase("c1")).toBeNull();
		await engine.pull();
		expect(await engine.storedRebase("nope")).toBeNull();
	});
});

describe("absentSince", () => {
	const twoPulls = () =>
		fakeDeviceApi({
			expenses: [page([custom]), page([], [{ id: "c1" }])],
		});

	it("is true only once a pull that began after the mark finished without the row", async () => {
		const { api } = twoPulls();
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		// The 404 came while pull 1 was the latest begun: it saw the row, so it resolves nothing.
		expect(await engine.absentSince("c1", engine.pullsBegun)).toBe(false);
		expect(await engine.absentSince("c1", 0)).toBe(false);
		await engine.pull();
		// Pull 2 began after a mark of 1, and the row is gone.
		expect(await engine.absentSince("c1", 1)).toBe(true);
		// A 404 that arrived while pull 2 ran: pull 2 began before it.
		expect(await engine.absentSince("c1", 2)).toBe(false);
	});

	it("is false while the row is still in the store, whatever the pull number", async () => {
		const { api } = fakeDeviceApi({ expenses: [page([custom])] });
		const engine = createDeviceEngine(api, "u1", Date.now, { warn });
		await engine.pull();
		await engine.pull();
		expect(await engine.absentSince("c1", 0)).toBe(false);
	});
});
