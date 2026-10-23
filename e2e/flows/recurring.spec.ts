import { expect, type Page, test } from "@playwright/test";
import { bannedOutputOn } from "../helpers/banned-output";
import { FigureAudit, type FiguresResponse } from "../helpers/figures";
import { untilSaved } from "../helpers/trpc";
import { enableV2ForViewer, openV2, realCategory } from "./v2-viewer";

type Money = { minor: number; currency: string };
type Cost = { month: Money; quarter: Money; year: Money };
type View = {
	items: { id: string; amount: Money }[];
	out: Cost;
	in: Cost | null;
};

/** The audit's API side: recurring.listView, as the page reads it. */
function viewFetcher(page: Page) {
	return async (ids: string[]): Promise<FiguresResponse> => {
		const res = await page.request.get("/api/trpc/recurring.listView");
		expect(res.ok()).toBe(true);
		const view = (await res.json()).result.data.json as View;
		const byId = new Map<string, Money>();
		for (const r of view.items) byId.set(`recurring.amount:${r.id}`, r.amount);
		for (const dir of ["out", "in"] as const)
			for (const period of ["month", "quarter", "year"] as const) {
				const cost = view[dir];
				if (cost) byId.set(`recurring.cost.${dir}.${period}`, cost[period]);
			}
		const figures = ids.flatMap((id) => {
			const m = byId.get(id);
			return m
				? [{ id, unit: "money" as const, minor: m.minor, currency: m.currency }]
				: [];
		});
		return { figures, missing: ids.filter((id) => !byId.has(id)) };
	};
}

test.beforeAll(enableV2ForViewer);

test("Recurring: add one, see it grouped and summed, confirm it", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	await openV2(page, "/activity/recurring");
	const main = page.getByRole("main");
	await expect(main.getByRole("link", { name: "Recurring" })).toHaveAttribute(
		"aria-current",
		"page",
	);

	// The main action: the header's Add recurring expense opens today's modal.
	const category = await realCategory(page, "Prueba e2e");
	await page.reload();
	await main
		.getByRole("button", { name: "Add recurring expense" })
		.first()
		.click();
	const dialog = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("button", { name: "Create Subscription" }) });
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Name").fill("Club de ajedrez");
	await dialog.locator("#amount").fill("15000");
	await dialog.getByRole("combobox", { name: "Select category" }).click();
	await page.getByRole("button", { name: category, exact: true }).click();
	await untilSaved(page, "recurring.create", () =>
		dialog.getByRole("button", { name: "Create Subscription" }).click(),
	);
	await expect(dialog).toBeHidden();

	const row = main
		.locator("tr[data-id]")
		.filter({ hasText: "Club de ajedrez" });
	await expect(row).toBeVisible();
	await expect(main.locator("[data-summary]")).toContainText(
		"Your recurring expenses cost",
	);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const audit = new FigureAudit(viewFetcher(page));
	expect(await audit.checkPage(page, "recurring")).toEqual([]);

	// A due one has Confirm on the row; confirming moves it out of Due now.
	const confirm = row.getByRole("button", { name: "Confirm" });
	if (await confirm.isVisible()) {
		await untilSaved(page, "recurring.confirmAndCreate", () => confirm.click());
		await expect(main.locator('tr[data-group="due"]')).toHaveCount(0);
	}
	expect(errors, "uncaught page errors").toEqual([]);
});
