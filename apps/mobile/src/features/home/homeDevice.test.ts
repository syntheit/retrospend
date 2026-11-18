import type { RetrospendClient } from "@retrospend/api-client";
import { fetchHome, type Glance, notPlannedOf } from "./source";

// Home's glance with the dev flag's device engine: the screen is the server's,
// the device only compares.

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

// What the device would have shown: every figure differs from the server's.
const device = () => ({ compare: jest.fn(async () => null) });

it("is today's call exactly when there is no device", async () => {
	const server = { ...base };
	for (const none of [undefined, null]) {
		const data = await fetchHome(api(server), none)();
		expect(data.glance).toBe(server);
	}
});

// AGENTS 6.1: the screen shows the server's numbers, whatever the device
// holds. The device is only asked to compare, for the "home" screen, and the
// compare is handed nothing to put on screen.
it("shows the server's glance as it came and only asks the device to compare", async () => {
	const source = device();
	const server = { ...base };
	const data = await fetchHome(api(server), source)();
	expect(data.glance).toBe(server);
	expect(source.compare).toHaveBeenCalledTimes(1);
	expect(source.compare).toHaveBeenCalledWith("home");
});

it("shows the server's Not planned yet", async () => {
	const ready = {
		...base,
		budget: {
			state: "ready",
			verdict: { poolName: "NOT_PLANNED_YET" },
			notPlannedYet: { id: "budget.notPlannedYet", value: money(5) },
		},
	} as unknown as Glance;
	const { glance } = await fetchHome(api(ready), device())();
	expect(notPlannedOf(glance)?.amount).toEqual(money(5));
});
