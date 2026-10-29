/**
 * GET /figures/insights/* on Postgres: each route answers what the web's
 * Insights service answers for the same user, in the contract's shape, with
 * the chips as comma-separated lists. A DKK user (USD 1 = DKK 7.00), Buenos
 * Aires:
 *   Aug 10 Groceries DKK 80
 *   Sep 3  Groceries DKK 100;  Sep 5  no category DKK 50
 *   Sep 20 income DKK 1,000
 * September is DKK 150 over two expenses, against DKK 80 in August (+88%).
 * Saved in September: 1,000 - 150 = 850, 85% of income.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	insightsCashflow,
	insightsMonths,
	insightsSummary,
	insightsYtd,
} from "~/server/services/insights";
import {
	category,
	dkk,
	insightsUser,
	row,
	seedDkkRates,
} from "~/server/services/insights/__tests__/fixture";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const ZONE = "America/Argentina/Buenos_Aires";
const SEP = "from=2026-09-01&to=2026-09-30";
/** Its own address, so the per-IP limit the other v1 files share never matters. */
const IP = { "x-forwarded-for": "198.51.100.93" };

/** JSON round trip: what the wire carries of a service's answer. */
const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe("insights routes", () => {
	let userId: string;
	let otherId: string;
	let groceries: string;
	let as: Record<string, string>;
	const get = (path: string, headers = as) =>
		call(path, { headers: { ...IP, ...headers } });

	beforeAll(async () => {
		await seedDkkRates();
		userId = await insightsUser({ zone: ZONE });
		otherId = await insightsUser({ zone: ZONE });
		groceries = await category(userId, "Groceries");
		await row(userId, {
			at: "2026-08-10T12:00:00-03:00",
			amount: "80",
			usd: "11.43",
			categoryId: groceries,
		});
		await row(userId, {
			at: "2026-09-03T12:00:00-03:00",
			amount: "100",
			usd: "14.29",
			categoryId: groceries,
		});
		await row(userId, {
			at: "2026-09-05T12:00:00-03:00",
			amount: "50",
			usd: "7.14",
		});
		await row(userId, {
			at: "2026-09-20T12:00:00-03:00",
			amount: "1000",
			usd: "142.86",
			kind: "income",
		});
		as = await asMobile(userId);
	});

	it("gives the summary with compare, as the web's service does", async () => {
		const body = await expectBody<{
			total: { value: unknown };
			previousTotal: { value: unknown } | null;
			changePct: number | null;
			count: number;
			categories: { categoryId: string | null; value: unknown }[];
		}>(
			await get(`/figures/insights/summary?${SEP}&compare=true`),
			contract.figures.insightsSummary,
		);
		expect(body.total.value).toEqual(dkk(15_000));
		expect(body.previousTotal?.value).toEqual(dkk(8_000));
		expect(body.changePct).toBe(88);
		expect(body.count).toBe(2);
		expect(body.categories.map((c) => [c.categoryId, c.value])).toEqual([
			[groceries, dkk(10_000)],
			[null, dkk(5_000)],
		]);
		const service = await insightsSummary(
			adminDb,
			userId,
			{ range: { from: "2026-09-01", to: "2026-09-30" }, compare: true },
			{ timeZone: ZONE },
		);
		expect(body).toEqual(wire(service));
	});

	it("narrows by the chips and leaves compare off by default", async () => {
		const body = await expectBody<{
			total: { value: unknown };
			previousTotal: unknown;
			count: number;
		}>(
			await get(`/figures/insights/summary?${SEP}&cat=${groceries}`),
			contract.figures.insightsSummary,
		);
		expect(body.total.value).toEqual(dkk(10_000));
		expect(body.count).toBe(1);
		expect(body.previousTotal).toBeNull();
	});

	it("gives the months ending at the range's month", async () => {
		const body = await expectBody<{
			months: { month: string; total: unknown }[];
		}>(
			await get("/figures/insights/months?to=2026-09-30&count=2"),
			contract.figures.insightsMonths,
		);
		expect(body.months.map((m) => [m.month, m.total])).toEqual([
			["2026-08", dkk(8_000)],
			["2026-09", dkk(15_000)],
		]);
		const service = await insightsMonths(
			adminDb,
			userId,
			{ to: "2026-09-30", count: 2 },
			{ timeZone: ZONE },
		);
		expect(body).toEqual(wire(service));
	});

	it("gives the year to date, as the web's service does", async () => {
		const body = await expectBody(
			await get(`/figures/insights/ytd?cat=${groceries}`),
			contract.figures.insightsYtd,
		);
		const service = await insightsYtd(
			adminDb,
			userId,
			{ filter: { categoryIds: [groceries] } },
			{ timeZone: ZONE },
		);
		expect(body).toEqual(wire(service));
	});

	it("gives income, saved and the savings rate", async () => {
		const body = await expectBody<{
			income: { value: unknown };
			saved: { value: unknown };
			savingsRatePct: number | null;
		}>(
			await get(`/figures/insights/cashflow?${SEP}`),
			contract.figures.insightsCashflow,
		);
		expect(body.income.value).toEqual(dkk(100_000));
		expect(body.saved.value).toEqual(dkk(85_000));
		expect(body.savingsRatePct).toBe(85);
		const service = await insightsCashflow(
			adminDb,
			userId,
			{ range: { from: "2026-09-01", to: "2026-09-30" } },
			{ timeZone: ZONE },
		);
		expect(body).toEqual(wire(service));
	});

	it("shows another user none of it", async () => {
		const body = await expectBody<{ total: { value: unknown }; count: number }>(
			await get(`/figures/insights/summary?${SEP}`, await asMobile(otherId)),
			contract.figures.insightsSummary,
		);
		expect(body.count).toBe(0);
		expect(body.total.value).toEqual(dkk(0));
	});

	it("refuses a range that ends before it starts", async () => {
		await expectProblem(
			await get("/figures/insights/summary?from=2026-09-30&to=2026-09-01"),
			400,
			"bad_request",
		);
		await expectProblem(
			await get("/figures/insights/cashflow?from=2026-09-30&to=2026-09-01"),
			400,
			"bad_request",
		);
	});

	it.each([
		"summary?from=2026-09-01&to=2026-09-30",
		"months?to=2026-09-30",
		"ytd",
		"cashflow?from=2026-09-01&to=2026-09-30",
	])("%s needs credentials and the read scope", async (path) => {
		await expectProblem(
			await call(`/figures/insights/${path}`, { headers: IP }),
			401,
			"unauthenticated",
		);
		await expectProblem(
			await get(
				`/figures/insights/${path}`,
				await asKey(userId, ["write:expenses"]),
			),
			403,
			"missing_scope",
		);
	});
});
