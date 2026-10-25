import { expect, type Page, test } from "@playwright/test";
import { personaStorageState } from "../../constants";
import { SOFIA, seedId } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import {
	FigureAudit,
	type FigureFetcher,
	type FiguresResponse,
} from "../../helpers/figures";
import { gotoReady } from "../../helpers/navigation";

// The redesigned Insights (uiV2, /activity/insights) on Sofía's seeded
// ledger: one total, by category, month by month, year to date with Show in
// USD, income and savings. Every figure matches the reads the page makes
// (and the figures API in the default view); a range change with Compare
// moves them together; a figure opens its expenses in Activity.

test.use({ storageState: personaStorageState(SOFIA.username) });

type Money = { minor: number; currency: string };
type Fig = { id: string; value: Money | null };
type Summary = {
	total: Fig;
	previousTotal: Fig | null;
	categories: {
		categoryId: string | null;
		figure: string;
		value: Money | null;
	}[];
};
type Months = {
	months: { month: string; figure: string; total: Money | null }[];
};
type Ytd = {
	total: { home: Fig; usd: Fig };
	lastYearTotal: { home: Fig; usd: Fig };
	categories: {
		categoryId: string | null;
		figure: string;
		usdFigure: string;
		value: { home: Money | null; usd: Money | null };
	}[];
};
type Cashflow = {
	income: Fig;
	saved: Fig;
	dailyAverage: Fig;
	monthlyAverage: Fig;
};

const RENT = seedId("cat", "sofia", "rent");

async function trpcQuery<T>(
	page: Page,
	path: string,
	input: unknown,
): Promise<T> {
	const q = encodeURIComponent(JSON.stringify({ json: input }));
	const res = await page.request.get(`/api/trpc/${path}?input=${q}`);
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

/** The viewer's today in the browser's zone, and the month it is in. */
async function monthOf(page: Page) {
	const today = await page.evaluate(() =>
		new Date().toLocaleDateString("en-CA"),
	);
	const [y, m] = today.split("-").map(Number) as [number, number];
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		today,
		from: `${y}-${pad(m)}-01`,
		to: `${y}-${pad(m)}-${pad(last)}`,
		label: `${y}-${pad(m)}`,
	};
}

/**
 * The audit's API side: the four reads the page makes, called with the same
 * range and no chips, keyed by the figure id each number carries (a scoped id
 * is the figure id, a colon and its category or month).
 */
function insightsFetcher(
	page: Page,
	range: { from: string; to: string },
	compare: boolean,
): FigureFetcher {
	return async (ids): Promise<FiguresResponse> => {
		const [summary, months, ytd, cashflow] = await Promise.all([
			trpcQuery<Summary>(page, "insights.summary", { range, compare }),
			trpcQuery<Months>(page, "insights.months", { to: range.to, count: 6 }),
			trpcQuery<Ytd>(page, "insights.ytd", {}),
			trpcQuery<Cashflow>(page, "insights.cashflow", { range }),
		]);
		const byId = new Map<string, Money>();
		const put = (id: string, value: Money | null) => {
			if (value) byId.set(id, value);
		};
		for (const f of [summary.total, summary.previousTotal, cashflow.income])
			if (f) put(f.id, f.value);
		for (const f of [cashflow.saved, cashflow.dailyAverage]) put(f.id, f.value);
		put(cashflow.monthlyAverage.id, cashflow.monthlyAverage.value);
		for (const c of summary.categories)
			if (c.categoryId) put(`${c.figure}:${c.categoryId}`, c.value);
		for (const m of months.months) put(`${m.figure}:${m.month}`, m.total);
		for (const f of [
			ytd.total.home,
			ytd.total.usd,
			ytd.lastYearTotal.home,
			ytd.lastYearTotal.usd,
		])
			put(f.id, f.value);
		for (const c of ytd.categories)
			if (c.categoryId) {
				put(`${c.figure}:${c.categoryId}`, c.value.home);
				put(`${c.usdFigure}:${c.categoryId}`, c.value.usd);
			}
		return {
			figures: ids.flatMap((id) => {
				const m = byId.get(id);
				return m
					? [
							{
								id,
								unit: "money" as const,
								minor: m.minor,
								currency: m.currency,
							},
						]
					: [];
			}),
			missing: ids.filter((id) => !byId.has(id)),
		};
	};
}

async function openInsights(page: Page, path = "/activity/insights") {
	await gotoReady(page, path);
	await expect(
		page.locator('[data-ui="v2"][data-page="insights"]'),
	).toBeVisible();
	// Every part has loaded: no skeletons left.
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test("Insights: figures match the reads, a range with Compare moves them, Show in USD, figures open Activity", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewportSize({ width: 1440, height: 900 });
	await openInsights(page);
	const main = page.getByRole("main");
	const month = await monthOf(page);

	await expect(main.getByRole("link", { name: "Insights" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	for (const heading of [
		"By category",
		"Month by month",
		"Year to date vs last year",
		"Income and savings",
	])
		await expect(
			main.getByRole("heading", { name: new RegExp(`^${heading}`) }),
		).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// The default view: this month. Its figures are the reads' and the registry's.
	const audit = new FigureAudit(insightsFetcher(page, month, false));
	expect(await audit.checkPage(page, "insights")).toEqual([]);
	const v1 = await page.request.get(
		"/api/v1/figures?ids=insights.spent,insights.ytd,insights.income",
	);
	expect(v1.ok()).toBe(true);
	const registry = (await v1.json()).figures as {
		id: string;
		lines: Money[] | null;
	}[];
	const summary = await trpcQuery<Summary>(page, "insights.summary", {
		range: month,
		compare: false,
	});
	expect(
		registry.find((f) => f.id === "insights.spent")?.lines?.[0]?.minor,
	).toBe(summary.total.value?.minor);

	// Show in USD: the same rows at the USD value each was saved with.
	await main.getByRole("button", { name: "Show in USD" }).click();
	await expect(main.getByText(/^Each expense in USD/)).toBeVisible();
	const usdAudit = new FigureAudit(insightsFetcher(page, month, false));
	expect(await usdAudit.checkPage(page, "insights usd", "insightsUsd")).toEqual(
		[],
	);
	await expect(
		main.locator('#ytd [data-figure="insights.ytdUsd"]'),
	).toContainText("USD");
	await main.getByRole("button", { name: "Show in USD" }).click();

	// A range with Compare: Last month against the month before it.
	await page.getByRole("button", { name: /^Dates: / }).click();
	await page.getByRole("button", { name: "Last month" }).click();
	await page
		.getByRole("switch", { name: /Compare to previous period/ })
		.click();
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(page).toHaveURL(/compare=1/);
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
	const url = new URL(page.url());
	const range = {
		from: url.searchParams.get("from") ?? "",
		to: url.searchParams.get("to") ?? "",
	};
	expect(range.from).not.toBe("");
	await expect(
		main.locator('[data-figure="insights.spentPrevious"]'),
	).toBeVisible();
	const moved = new FigureAudit(insightsFetcher(page, range, true));
	expect(
		await moved.checkPage(page, "insights last month", "insightsCompare"),
	).toEqual([]);

	// A figure opens the expenses behind it: Rent opens Activity on that
	// range, filtered to the category.
	await main.locator(`#by-category a[href*="cat=${RENT}"]`).first().click();
	await expect(page).toHaveURL(
		new RegExp(`/activity\\?.*cat=${RENT}.*from=${range.from}.*to=${range.to}`),
	);
	await expect(
		page.locator('[data-ui="v2"][data-page="activity"]'),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	expect(errors).toEqual([]);
});

test("Insights: a filter with no spending says so and clears; a phone has no sideways scroll", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	// A category id nothing was spent in: no rows match, whatever the range.
	await openInsights(page, "/activity/insights?range=all&cat=none-such");
	const main = page.getByRole("main");
	await expect(
		main.getByText("No spending matches these filters"),
	).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await main.getByRole("button", { name: "Clear filters" }).click();
	await expect(
		main.getByRole("heading", { name: /^By category/ }),
	).toBeVisible();
	const after = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(after).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
