import { expect, type Page, test } from "@playwright/test";
import { SOFIA } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { FigureAudit, type FiguresResponse } from "../../helpers/figures";
import { untilSaved } from "../../helpers/trpc";
import { openV2, realCategory, V2_VIEWER_SESSION } from "./viewer";

type Money = { minor: number; currency: string };
type Row = { id: string; amount: Money; home?: Money | null; share?: Money };
type ListPage = {
	items: Row[];
	today: string;
	total: { figure: string; value: Money } | null;
	dayTotals: Record<string, Money> | null;
};

/** One tRPC query as the app's client sends it (superjson, GET). */
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

/**
 * The figures endpoint does not serve row ids yet (GAPS), so the audit
 * compares each tagged amount with the same rows read from expense.listV2.
 */
function listFetcher(page: Page, input: object) {
	return async (ids: string[]): Promise<FiguresResponse> => {
		const { items, total, dayTotals } = await trpcQuery<ListPage>(
			page,
			"expense.listV2",
			{
				...input,
				limit: 200,
			},
		);
		const byId = new Map<string, Money>();
		for (const r of items) {
			byId.set(`entry.amount:${r.id}`, r.amount);
			if (r.share) byId.set(`entry.share:${r.id}`, r.share);
		}
		// The footer and day totals are spent() for the same filter.
		if (total) byId.set(total.figure, total.value);
		for (const [day, m] of Object.entries(dayTotals ?? {}))
			byId.set(`spent.day:${day}`, m);
		const figures = ids.flatMap((id) => {
			const m = byId.get(id);
			return m
				? [{ id, unit: "money" as const, minor: m.minor, currency: m.currency }]
				: [];
		});
		return { figures, missing: ids.filter((id) => !byId.has(id)) };
	};
}

test.use({ storageState: V2_VIEWER_SESSION });

test("Activity: shared rows, payments, accent search and Add expense", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	// Everything Martín shares with Sofía, every month: the Depto bills and his payment.
	const sofia = `user:${SOFIA.id}`;
	await openV2(page, `/activity?person=${encodeURIComponent(sofia)}&range=all`);
	const main = page.getByRole("main");
	await expect(
		main.getByRole("heading", { name: "Activity", level: 1 }),
	).toBeVisible();
	await expect(main.getByRole("link", { name: "Recurring" })).toBeVisible();
	await expect(main.getByText("Arreglo del calefón").first()).toBeVisible();
	await expect(main.getByText("You paid Sofía").first()).toBeVisible();
	await expect(main.getByText("your share").first()).toBeVisible();

	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const audit = new FigureAudit(listFetcher(page, { people: [sofia] }));
	expect(await audit.checkPage(page, "activity")).toEqual([]);
	expect(audit.figureCount).toBeGreaterThan(5);

	// The month view's footer is spent() for this month, from the server.
	await page.goto("/activity");
	await expect(main.locator("tfoot")).toBeVisible();
	const { today } = await trpcQuery<ListPage>(page, "expense.listV2", {
		limit: 1,
	});
	const [y, m] = today.split("-").map(Number) as [number, number];
	const month = {
		from: `${today.slice(0, 8)}01`,
		to: `${today.slice(0, 8)}${new Date(Date.UTC(y, m, 0)).getUTCDate()}`,
	};
	const monthAudit = new FigureAudit(listFetcher(page, month));
	expect(await monthAudit.checkPage(page, "activityMonth")).toEqual([]);

	// RC-10: no accent, any month.
	await openV2Search(page, "calefon");
	await expect(main.getByText("Arreglo del calefón").first()).toBeVisible();
	await expect(main.getByText("Expensas")).toHaveCount(0);

	// The main action: Add goes through today's expense modal and the row shows up.
	const category = await realCategory(page, "Prueba e2e");
	await page.goto("/activity");
	const dialog = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("button", { name: "Create Expense" }) });
	await page
		.getByRole("button", { name: "Add expense", exact: true })
		.first()
		.click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox", { name: "Amount" }).fill("4321");
	await dialog
		.getByRole("textbox", { name: "Expense Title" })
		.fill("Café de prueba");
	await dialog
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: category, exact: true })
		.click();
	await untilSaved(page, "expense.createExpense", () =>
		dialog.getByRole("button", { name: "Create Expense" }).click(),
	);
	await expect(dialog).toBeHidden();
	await expect(main.getByText("Café de prueba").first()).toBeVisible();
	expect(errors, "uncaught page errors").toEqual([]);
});

async function openV2Search(page: Page, q: string) {
	const main = page.getByRole("main");
	const search = main.getByRole("searchbox", {
		name: "Search expenses or amounts",
	});
	await page.goto("/activity");
	// "/" focuses the search from anywhere on the page.
	await main.getByRole("heading", { name: "Activity", level: 1 }).click();
	await page.keyboard.press("/");
	await expect(search).toBeFocused();
	await page.keyboard.type(q);
	await expect(page).toHaveURL(new RegExp(`q=${q}`));
}
