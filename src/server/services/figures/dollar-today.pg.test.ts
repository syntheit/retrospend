/**
 * Dollar today on a real Postgres. PLN is this file's currency (no other pg
 * file prices it): official 10.20 and blue 10.80, both dated before any run
 * date, so the number does not move with the clock.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { glance } from "./glance";

const NOW = new Date("2026-10-24T15:00:00Z");

async function user(home: string, defaults: object = {}) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: home, defaultRateTypes: defaults },
	});
	return user.id;
}

beforeAll(async () => {
	for (const [date, type, rate] of [
		["2026-10-01T00:00:00.000Z", "official", "10.20"],
		["2026-10-20T00:00:00.000Z", "blue", "10.80"],
	] as const) {
		const day = new Date(date);
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: day, currency: "PLN", type } },
			create: { date: day, currency: "PLN", type, rate },
			update: {},
		});
	}
});

describe("figure rate.dollarToday", () => {
	it("the price of USD 1 in the home currency at the table's first choice (blue): PLN 10.80", async () => {
		const id = await user("PLN");
		const r = await readFigures(id, ["rate.dollarToday"]);
		expect(r.get("rate.dollarToday")).toEqual([
			{ minor: 1_080, currency: "PLN" },
		]);
	});

	it("the rate type the person chose for that home currency wins", async () => {
		const id = await user("PLN", { PLN: "official" });
		const r = await readFigures(id, ["rate.dollarToday"]);
		expect(r.get("rate.dollarToday")).toEqual([
			{ minor: 1_020, currency: "PLN" },
		]);
	});

	it("a home currency with no rates reads unavailable, never 1", async () => {
		const id = await user("ISK");
		const r = await readFigures(id, ["rate.dollarToday"]);
		expect(r.get("rate.dollarToday")).toBeNull();
	});

	it("a USD home has no such row", async () => {
		const id = await user("USD");
		expect(
			(await readFigures(id, ["rate.dollarToday"])).get("rate.dollarToday"),
		).toBeNull();
	});
});

describe("glance dollarToday", () => {
	it("carries the figure, the rate type used and the day the rate is from", async () => {
		const id = await user("PLN");
		const g = await glance(adminDb, id, {
			budget: false,
			now: NOW,
			timeZone: "UTC",
		});
		expect(g.dollarToday).toEqual({
			id: "rate.dollarToday",
			value: { minor: 1_080, currency: "PLN" },
			rateType: "blue",
			rateDate: "2026-10-20",
			home: "PLN",
		});
	});

	it("no rate at all: the row stays with no value, the type unknown", async () => {
		const id = await user("ISK");
		const g = await glance(adminDb, id, {
			budget: false,
			now: NOW,
			timeZone: "UTC",
		});
		expect(g.dollarToday).toEqual({
			id: "rate.dollarToday",
			value: null,
			rateType: null,
			rateDate: null,
			home: "ISK",
		});
	});

	it("USD and crypto homes leave the row out", async () => {
		for (const home of ["USD", "BTC"]) {
			const g = await glance(adminDb, await user(home), {
				budget: false,
				now: NOW,
				timeZone: "UTC",
			});
			expect(g.dollarToday, home).toBeNull();
		}
	});
});
