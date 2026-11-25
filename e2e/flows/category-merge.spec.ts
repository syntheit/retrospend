import { expect, type Page, test } from "../fixtures/sealed-guard";
import { gotoReady } from "../helpers/navigation";
import { V2_VIEWER_SESSION } from "./viewer";

test.use({ storageState: V2_VIEWER_SESSION });

/** Optional: E2E_SHOTS_DIR saves each state of the sheet, both themes, 1440 and 390. */
const shotsDir = process.env.E2E_SHOTS_DIR;

const origin = (page: Page) => new URL(page.url()).origin;

async function post(page: Page, path: string, json: unknown, meta?: unknown) {
	const res = await page.request.post(`/api/trpc/${path}`, {
		data: { json, ...(meta ? { meta } : {}) },
		headers: { Origin: origin(page) },
	});
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json;
}

async function get(page: Page, path: string, json: unknown) {
	const q = encodeURIComponent(JSON.stringify({ json }));
	const res = await page.request.get(`/api/trpc/${path}?input=${q}`);
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json;
}

/** The category each expense is filed under, as the API reads it. */
async function categoriesOf(page: Page, ids: string[]) {
	const out: Record<string, string | null> = {};
	for (const id of ids)
		out[id] = (await get(page, "entry.expense.get", { id })).categoryId ?? null;
	return out;
}

test("Settings: merging a category shows what moves, Save moves it, Undo brings everything back", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const problems: string[] = [];
	page.on("pageerror", (e) => problems.push(e.message));
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/settings");

	// Opening the catalog seeds the income categories, before the page reads them.
	await get(page, "entry.catalog", undefined);
	const income = (await get(page, "categories.getAll", {})).find(
		(c: { kind: string }) => c.kind === "INCOME",
	);
	expect(income, "an income category").toBeTruthy();

	const stamp = Date.now();
	const from = `Merge from ${stamp}`;
	const into = `Merge into ${stamp}`;
	const source = await post(page, "categories.create", {
		name: from,
		color: "teal",
	});
	const target = await post(page, "categories.create", {
		name: into,
		color: "amber",
	});
	const ids: string[] = [];
	for (const n of [1, 2, 3]) {
		const id = crypto.randomUUID();
		await post(
			page,
			"expense.createExpense",
			{
				id,
				title: `Merge row ${stamp} ${n}`,
				amount: 777 * n,
				currency: "ARS",
				date: new Date().toISOString(),
				categoryId: source.id,
			},
			{ values: { date: ["Date"] } },
		);
		ids.push(id);
	}
	const before = await categoriesOf(page, ids);
	expect(Object.values(before)).toEqual([source.id, source.id, source.id]);

	// The shots: each state, both themes, at the desktop and the phone width.
	const shoot = async (name: string) => {
		if (!shotsDir) return;
		for (const [width, height] of [
			[1440, 900],
			[390, 844],
		] as const) {
			await page.setViewportSize({ width, height });
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.evaluate((t) => {
					localStorage.setItem("theme-preference", t);
					document.documentElement.dataset.theme = t;
					document.documentElement.classList.toggle("dark", t === "dark");
				}, theme);
				await page.waitForTimeout(300);
				await page.screenshot({
					path: `${shotsDir}/${name}-${theme}-${width}.png`,
				});
			}
		}
		await page.setViewportSize({ width: 1440, height: 900 });
	};

	// What the server says it would do: the sheet must show these numbers.
	const answer = await get(page, "categories.previewRemove", {
		id: source.id,
		targetId: target.id,
	});
	expect(answer.value.counts.expense.moved).toBe(3);
	expect(answer.value.counts.expense.dropped).toBe(0);

	// A new URL, not only a new hash: the page must read the categories made above.
	await gotoReady(page, "/settings?fresh=1#categories");
	await page.getByRole("button", { name: /^Show all/ }).click();
	await page.getByLabel(`Edit ${from}`).click();
	await page.getByRole("button", { name: "Delete category" }).click();

	const sheet = page.getByRole("dialog", { name: `Delete ${from}` });
	await expect(sheet).toBeVisible();
	// Delete with nothing chosen: the rows go to no category, and your spending stays.
	const changes = sheet.getByTestId("entry-changes");
	await expect(changes).toContainText("your spending");
	const row = (label: string) =>
		changes.locator(`div:has(> span:text-is("${label}"))`);
	await expect(row("Expenses")).toContainText("3");
	await expect(row("Expenses")).toContainText("No category");
	await shoot("category-delete-preview");

	await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
	await page.getByRole("option", { name: into }).click();
	await expect(row("Expenses")).toContainText(
		String(answer.value.counts.expense.moved),
	);
	await expect(row("Expenses")).toContainText(into);
	await expect(changes).toContainText("your spending");
	await shoot("category-merge-preview");

	// An income category cannot take expenses: the sheet says so and Save stays off.
	await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
	await page.getByRole("option", { name: income.name, exact: true }).click();
	await expect(changes).toContainText(
		"An expense category and an income category cannot be merged.",
	);
	await expect(
		sheet.getByRole("button", { name: "Move and delete" }),
	).toBeDisabled();
	await shoot("category-refusal-kind");

	// The other two refusals reach the web the same way, by their code: the
	// real answer, with the code swapped, so only the wording is under test.
	if (shotsDir) {
		let swapped: string = "category_kind_mismatch";
		await page.route(/categories\.previewRemove/, async (route) => {
			const res = await route.fetch();
			const body = (await res.text()).replace(
				"category_kind_mismatch",
				swapped,
			);
			await route.fulfill({ response: res, body });
		});
		for (const [code, name] of [
			["category_closed_month", "category-refusal-closed-month"],
			["category_income_rule", "category-refusal-income-rule"],
		] as const) {
			swapped = code;
			await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
			await page.getByRole("option", { name: into }).click();
			await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
			await page
				.getByRole("option", { name: income.name, exact: true })
				.click();
			await expect(changes).toContainText("This cannot be saved.");
			await shoot(name);
		}
		await page.unroute(/categories\.previewRemove/);
	}

	// Back to the merge: a failed save keeps the sheet open with its error.
	await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
	await page.getByRole("option", { name: into }).click();
	await expect(
		sheet.getByRole("button", { name: "Move and delete" }),
	).toBeEnabled();
	await page.route(/categories\.remove/, (route) => route.abort());
	await sheet.getByRole("button", { name: "Move and delete" }).click();
	await expect(sheet.getByRole("alert")).toBeVisible();
	expect(await categoriesOf(page, ids)).toEqual(before);
	await page.unroute(/categories\.remove/);

	await sheet.getByRole("button", { name: "Move and delete" }).click();
	await expect(
		page.getByText(`Moved 3 expenses to ${into} and deleted ${from}`),
	).toBeVisible();
	await shoot("category-merge-saved");
	const moved = await categoriesOf(page, ids);
	for (const id of ids) expect(moved[id], id).toBe(target.id);
	const left = await get(page, "categories.getAll", {});
	expect(left.some((c: { id: string }) => c.id === source.id)).toBe(false);

	await page.getByRole("button", { name: "Undo" }).click();
	await expect
		.poll(async () => (await categoriesOf(page, ids))[ids[0] ?? ""])
		.toBe(source.id);
	expect(await categoriesOf(page, ids)).toEqual(before);
	const back = await get(page, "categories.getAll", {});
	expect(back.some((c: { id: string }) => c.id === source.id)).toBe(true);

	expect(problems, "uncaught page errors").toEqual([]);
	for (const id of ids) await post(page, "expense.deleteExpense", { id });
	for (const c of [source, target])
		await post(page, "categories.remove", { id: c.id, targetId: null });
});
