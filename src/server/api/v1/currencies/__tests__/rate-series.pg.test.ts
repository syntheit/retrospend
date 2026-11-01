/**
 * /api/v1 rate history and per-currency spending on Postgres, and the
 * `currency` key of the expenses filter: the same server figures the web
 * dialog shows, for the mobile app. MMK and AFN are stored by no other pg
 * test (rates are global).
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.currencies;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

type Series = {
	currency: string;
	home: string;
	range: string;
	base: string | null;
	defaultType: string | null;
	series: {
		type: string;
		derived: boolean;
		changeBp: number | null;
		points: {
			date: string;
			price: { minor: number; currency: string; places: number };
		}[];
	}[];
};

describe("/api/v1 rate series and currency spending", () => {
	let as: Record<string, string>;

	beforeAll(async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "MMK" },
		});
		as = await asMobile(user.id);
		await adminDb.exchangeRateHistory.createMany({
			data: [
				{
					date: day("2026-10-01"),
					currency: "MMK",
					type: "official",
					rate: "2100",
				},
				{
					date: day("2026-10-02"),
					currency: "MMK",
					type: "official",
					rate: "2200",
				},
				{
					date: day("2026-10-01"),
					currency: "AFN",
					type: "official",
					rate: "70",
				},
				{
					date: day("2026-10-02"),
					currency: "AFN",
					type: "official",
					rate: "70",
				},
			],
		});
		await adminDb.exchangeRate.createMany({
			data: [
				{
					date: day("2026-10-02"),
					currency: "MMK",
					type: "official",
					rate: "2200",
				},
				{
					date: day("2026-10-02"),
					currency: "AFN",
					type: "official",
					rate: "70",
				},
			],
		});
		await adminDb.expense.create({
			data: {
				userId: user.id,
				title: "Kabul bazaar",
				amount: "700",
				currency: "AFN",
				amountInUSD: "10",
				exchangeRate: "70",
				pricingSource: "MANUAL",
				date: day("2026-10-02"),
			},
		});
	});

	it("serves the history priced against the home currency", async () => {
		const h = await expectBody<Series>(
			await call("/rates/AFN/series?range=ALL", { headers: as }),
			c.rateSeries,
		);
		expect(h).toMatchObject({
			currency: "AFN",
			home: "MMK",
			range: "ALL",
			base: "AFN",
			defaultType: "official",
		});
		// 2100 / 70 = 30.00 and 2200 / 70 = 31.43 MMK for 1 AFN.
		expect(h.series[0]?.points.map((p) => p.price.minor)).toEqual([3000, 3143]);
		expect(h.series[0]?.changeBp).toBe(476);
	});

	it("is empty without a rate and defaults the range", async () => {
		const none = await expectBody<Series>(
			await call("/rates/NPR/series", { headers: as }),
			c.rateSeries,
		);
		expect(none.range).toBe("3M");
		expect(none.series).toEqual([]);
		expect(none.base).toBeNull();
	});

	it("totals what the caller spent in a currency", async () => {
		const s = await expectBody<{
			count: number;
			original: { minor: number; currency: string };
			inHome: { minor: number; currency: string } | null;
		}>(
			await call("/currencies/AFN/spending", { headers: as }),
			c.currencySpending,
		);
		expect(s.count).toBe(1);
		expect(s.original).toEqual({ minor: 70000, currency: "AFN" });
		// USD 10 at MMK 2,200 per USD.
		expect(s.inHome).toEqual({ minor: 2200000, currency: "MMK" });
	});

	it("filters expenses by currency", async () => {
		const list = await call("/expenses?filter=currency%3DAFN%26range%3Dall", {
			headers: as,
		});
		const body = (await list.json()) as { items: { title: string }[] };
		expect(body.items.map((i) => i.title)).toEqual(["Kabul bazaar"]);
		const other = await call("/expenses?filter=currency%3DEUR%26range%3Dall", {
			headers: as,
		});
		expect(((await other.json()) as { items: unknown[] }).items).toEqual([]);
		await expectProblem(
			await call("/expenses?filter=currency%3Dars", { headers: as }),
			400,
			"invalid_filter",
		);
	});

	it("checks the input and the scope", async () => {
		await expectProblem(
			await call("/rates/AFN/series?range=2Y", { headers: as }),
			400,
			"validation_failed",
		);
		await expectProblem(
			await call("/rates/AFN/series"),
			401,
			"unauthenticated",
		);
		const user = (await createTestUser()).user.id;
		await expectProblem(
			await call("/currencies/AFN/spending", {
				headers: await asKey(user, ["write:settings"]),
			}),
			403,
			"missing_scope",
		);
	});
});
