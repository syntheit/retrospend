import type { RetrospendClient } from "@retrospend/api-client";
import type { DeviceRead } from "@/data/device-engine";
import { fetchHome, type Glance, notPlannedOf } from "./source";

// Home's glance with the dev flag's device engine: the figures the device can
// read come from it, and the call is the same as ever when there is none.

const money = (minor: number) => ({ minor, currency: "ARS" });

const base = {
	home: "ARS",
	today: "2026-10-25",
	period: { from: "2026-10-01", to: "2026-10-31", days: 31, day: 25 },
	lastPeriod: { from: "2026-09-01", to: "2026-09-30", days: 30 },
	spent: { id: "glance.spent", value: money(167467100) },
	spentLastToDate: { id: "glance.spentLastToDate", value: money(379923200) },
	spentLast: { id: "glance.spentLast", value: money(391103200) },
	pace: { this: null, last: null, fasterThanLast: null },
	owedToYou: { id: "owed.owedToYou", value: money(1) },
	youOwe: { id: "owed.youOwe", value: money(2) },
	netWorth: { id: "netWorth", value: money(9) },
	budget: null,
	moneyIn: null,
	dollarToday: null,
	missingRates: [],
} satisfies Glance;

const api = (glance: Glance) =>
	({
		figures: { glance: jest.fn(async () => glance) },
		"needs-you": { list: async () => ({ items: [] }) },
		expenses: { list: async () => ({ items: [], nextCursor: null }) },
		people: { list: async () => ({ people: [], home: "ARS" }) },
	}) as unknown as RetrospendClient;

const device = (read: DeviceRead | null) => ({
	read: jest.fn(async (_ids: readonly string[]) => read),
	verify: jest.fn(async (_ids: readonly string[]) => {}),
});

const read = (
	readings: Record<string, ReturnType<typeof money>[] | null>,
	o: Partial<DeviceRead> = {},
): DeviceRead => ({
	homeCurrency: "ARS",
	budgetReady: false,
	readings: new Map(Object.entries(readings)),
	...o,
});

it("is today's call exactly when there is no device", async () => {
	const server = { ...base };
	for (const none of [undefined, null]) {
		const data = await fetchHome(api(server), none)();
		expect(data.glance).toBe(server);
	}
});

// The device has Spent (1.11), Spent by this day last month (2.22) and net
// worth (3.33); Spent last month has no rate there, so it reads null. Owed to
// you and You owe are not the device's, so they stay the server's.
it("takes the figures the device has and leaves the rest as the server sent them", async () => {
	const source = device(
		read({
			"glance.spent": [money(111)],
			"glance.spentLastToDate": [money(222)],
			"glance.spentLast": null,
			netWorth: [money(333)],
		}),
	);
	const { glance } = await fetchHome(api(base), source)();
	expect(glance).toEqual({
		...base,
		spent: { id: "glance.spent", value: money(111) },
		spentLastToDate: { id: "glance.spentLastToDate", value: money(222) },
		spentLast: { id: "glance.spentLast", value: null },
		netWorth: { id: "netWorth", value: money(333) },
	});
	expect(source.read).toHaveBeenCalledWith([
		"glance.spent",
		"glance.spentLastToDate",
		"glance.spentLast",
		"owed.owedToYou",
		"owed.youOwe",
		"netWorth",
	]);
	expect(source.verify).toHaveBeenCalledWith([
		"glance.spent",
		"glance.spentLastToDate",
		"glance.spentLast",
		"netWorth",
	]);
});

it("keeps the server's glance when the device has nothing it can trust", async () => {
	const source = device(null);
	const server = { ...base };
	expect((await fetchHome(api(server), source)()).glance).toBe(server);
	expect(source.verify).not.toHaveBeenCalled();
});

it("keeps the server's glance when the device's home currency is another one", async () => {
	const source = device(
		read({ "glance.spent": [money(111)] }, { homeCurrency: "USD" }),
	);
	const server = { ...base };
	expect((await fetchHome(api(server), source)()).glance).toBe(server);
	expect(source.verify).not.toHaveBeenCalled();
});

describe("Not planned yet", () => {
	const ready = {
		...base,
		budget: {
			state: "ready",
			verdict: { poolName: "NOT_PLANNED_YET" },
			notPlannedYet: { id: "budget.notPlannedYet", value: money(5) },
		},
	} as unknown as Glance;
	const readings = { "budget.notPlannedYet": [money(7)] };

	it("comes from the device while its budget block is readable", async () => {
		const source = device(read(readings, { budgetReady: true }));
		const { glance } = await fetchHome(api(ready), source)();
		expect(notPlannedOf(glance)?.amount).toEqual(money(7));
		expect(source.read.mock.calls[0]?.[0]).toContain("budget.notPlannedYet");
		expect(source.verify).toHaveBeenCalledWith(["budget.notPlannedYet"]);
	});

	it("stays the server's while the block is not readable", async () => {
		const source = device(read(readings, { budgetReady: false }));
		const { glance } = await fetchHome(api(ready), source)();
		expect(notPlannedOf(glance)?.amount).toEqual(money(5));
		expect(source.verify).not.toHaveBeenCalled();
	});
});
