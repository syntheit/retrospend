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
	const changes = sheet.getByTestId("entry-changes");
	await expect(changes).toContainText("your spending");
	const row = (label: string) =>
		changes.locator(`div:has(> span:text-is("${label}"))`);
	const save = sheet.getByRole("button", {
		name: /^(Delete|Move and delete)$/,
	});
	await expect(save).toBeEnabled();
	// The first category of its kind is the default, not No category, and an
	// income category is not offered for an expense category.
	const move = sheet.getByRole("combobox", { name: "Move expenses to" });
	await expect(move).not.toContainText("No category");
	await move.click();
	await expect(page.getByRole("option", { name: "No category" })).toBeVisible();
	await expect(
		page.getByRole("option", { name: income.name, exact: true }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");

	// A second opening is not the first one's answer: Save waits for a dry run
	// made after the sheet opened, even for the same category and target.
	await sheet.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet).toBeHidden();
	await page.getByRole("button", { name: "Delete category" }).click();
	await expect(save).toBeDisabled();
	await expect(save).toBeEnabled();

	// Delete with no target: the rows go to no category, and your spending stays.
	await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
	await page.getByRole("option", { name: "No category" }).click();
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

	// The sheet's wording of each refusal, by its code (shots only). The real
	// server refuses an expense category merged into an income one; the other
	// two codes are that answer with the code swapped, so only the wording is
	// under test.
	const pick = async (name: string) => {
		await sheet.getByRole("combobox", { name: "Move expenses to" }).click();
		await page.getByRole("option", { name, exact: true }).click();
	};
	if (shotsDir) {
		let swapped = "";
		await page.route(/categories\.previewRemove/, async (route) => {
			const url = route.request().url().split(target.id).join(income.id);
			const res = await route.fetch({ url });
			const body = (await res.text()).replace(
				"category_kind_mismatch",
				swapped,
			);
			await route.fulfill({ response: res, body });
		});
		for (const [code, name] of [
			["category_kind_mismatch", "category-refusal-kind"],
			["category_closed_month", "category-refusal-closed-month"],
			["category_income_rule", "category-refusal-income-rule"],
		] as const) {
			swapped = code;
			await pick("No category");
			await pick(into);
			await expect(changes).toContainText("This cannot be saved.");
			await expect(
				sheet.getByRole("button", { name: "Move and delete" }),
			).toBeDisabled();
			await shoot(name);
		}
		await page.unroute(/categories\.previewRemove/);
		await pick("No category");
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

	// Cmd or Ctrl+Enter saves, like every sheet.
	await page.keyboard.press("Control+Enter");
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
