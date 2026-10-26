import { expect, type Page, test } from "@playwright/test";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import {
	FigureAudit,
	type FigureFetcher,
	type FiguresResponse,
	httpFigureFetcher,
} from "../helpers/figures";
import { untilSaved } from "../helpers/trpc";
import {
	openV2,
	realCategory,
	uncategorizedExpense,
	V2_VIEWER_SESSION,
} from "./viewer";

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

const NONE: FiguresResponse = { figures: [] };

/**
 * Row amounts and shares are registry figures (entry.amount, entry.share), so
 * the endpoint serves them by row id. The footer and day totals are spent()
 * for the page's own filter, which the endpoint has no narrowing for, so
 * those compare with the same listV2 read the page makes.
 */
function listFetcher(page: Page, input: object): FigureFetcher {
	const served = httpFigureFetcher(page.request);
	const totals = async (ids: string[]): Promise<FiguresResponse> => {
		const { total, dayTotals } = await trpcQuery<ListPage>(
			page,
			"expense.listV2",
			{ ...input, limit: 200 },
		);
		const byId = new Map<string, Money>();
		if (total) byId.set(total.figure, total.value);
		for (const [day, m] of Object.entries(dayTotals ?? {}))
			byId.set(`spent.day:${day}`, m);
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
	return async (ids, currencies) => {
		const rows = ids.filter((id) => id.startsWith("entry."));
		const rest = ids.filter((id) => !id.startsWith("entry."));
		const [a, b] = await Promise.all([
			rows.length ? served(rows, currencies) : NONE,
			rest.length ? totals(rest) : NONE,
		]);
		return {
			figures: [...a.figures, ...b.figures],
			missing: [...(a.missing ?? []), ...(b.missing ?? [])],
		};
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

	// The main action: Add opens the v2 Add expense sheet (4G) and the row shows up.
	const category = await realCategory(page, "Prueba e2e");
	await page.goto("/activity");
	const dialog = page.getByRole("dialog", { name: "New expense" });
	await page
		.getByRole("button", { name: "Add expense", exact: true })
		.first()
		.click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox", { name: "Amount" }).fill("4321");
	await dialog.getByRole("textbox", { name: "Title" }).fill("Café de prueba");
	// A new category is not in the recents line yet: All opens the picker.
	await dialog
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: "All" })
		.click();
	await page.getByRole("option", { name: category }).click();
	await untilSaved(page, "entry.expense.create.save", () =>
		dialog.getByRole("button", { name: "Add expense" }).click(),
	);
	await expect(dialog).toBeHidden();
	await expect(main.getByText("Café de prueba").first()).toBeVisible();
	expect(errors, "uncaught page errors").toEqual([]);
});

test("Activity: No category lists spending without one, in the chip, the rows and the footer", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await openV2(page, "/activity");
	const title = `Sin categoría e2e ${Date.now()}`;
	const id = await uncategorizedExpense(page, title);
	const main = page.getByRole("main");

	// A link from Insights: every month, the chip says what it is.
	await openV2(page, "/activity?cat=none");
	await expect(main.getByText(title)).toBeVisible();
	await expect(
		main.getByRole("button", { name: "No category", exact: true }),
	).toBeVisible();

	// The footer is spent() for the same filter (shares in another person's
	// category count here, as in Insights); the new row is in the read.
	const read = await trpcQuery<{ items: { id: string }[] }>(
		page,
		"expense.listV2",
		{ categoryIds: ["none"], limit: 200 },
	);
	expect(read.items.map((r) => r.id)).toContain(id);
	const audit = new FigureAudit(listFetcher(page, { categoryIds: ["none"] }));
	expect(await audit.checkPage(page, "activity no category")).toEqual([]);

	// The menu offers it: picking it from a clean Activity writes ?cat=none.
	await openV2(page, "/activity?range=all");
	await main.getByRole("button", { name: "Category", exact: true }).click();
	await page.getByRole("option", { name: "No category" }).click();
	await expect(page).toHaveURL(/cat=none/);
	await expect(main.getByText(title)).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	const del = await page.request.post("/api/trpc/expense.deleteExpense", {
		data: { json: { id } },
		headers: { Origin: new URL(page.url()).origin },
	});
	expect(del.ok(), "cleanup").toBe(true);
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
