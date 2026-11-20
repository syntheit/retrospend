import { expect, type Page, test } from "../fixtures/sealed-guard";
import { openV2, V2_VIEWER_SESSION } from "./viewer";

test.use({ storageState: V2_VIEWER_SESSION });

/** The row as the list reads it: its category and whether analytics leave it out. */
async function rowsOf(page: Page, ids: string[]) {
	const out: Record<string, { categoryId: string | null; excluded: boolean }> =
		{};
	for (const id of ids) {
		const q = encodeURIComponent(JSON.stringify({ json: { id } }));
		const res = await page.request.get(
			`/api/trpc/entry.expense.get?input=${q}`,
		);
		expect(res.ok(), `entry.expense.get ${res.status()}`).toBe(true);
		const row = (await res.json()).result.data.json;
		out[id] = {
			categoryId: row.categoryId ?? null,
			excluded: row.excludeFromAnalytics === true,
		};
	}
	return out;
}

async function post(page: Page, path: string, json: unknown, meta?: unknown) {
	const res = await page.request.post(`/api/trpc/${path}`, {
		data: { json, ...(meta ? { meta } : {}) },
		headers: { Origin: new URL(page.url()).origin },
	});
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json;
}

/** Optional: E2E_SHOTS_DIR saves the preview sheet in both themes. */
const shotsDir = process.env.E2E_SHOTS_DIR;

test("Activity: Categorize shows what it changes, and Undo puts the category and analytics flag back", async ({
	page,
}) => {
	await page.goto("/activity");
	const stamp = Date.now();
	const held = `Held ${stamp}`;
	const title = `Bulk ${stamp}`;
	const category = await post(page, "categories.create", {
		name: held,
		color: "teal",
		excludeByDefault: true,
	});
	const heldId: string = category.id;
	const ids: string[] = [];
	for (const n of [1, 2]) {
		const id = crypto.randomUUID();
		await post(
			page,
			"expense.createExpense",
			{
				id,
				title: `${title} ${n}`,
				amount: 777,
				currency: "ARS",
				date: new Date().toISOString(),
			},
			{ values: { date: ["Date"] } },
		);
		ids.push(id);
	}
	const before = await rowsOf(page, ids);

	// Selection and the bulk bar are desktop only (phones list rows by day), so only 1440 has a sheet to see.
	const shoot = async (name: string) => {
		if (!shotsDir) return;
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.evaluate((t) => {
				localStorage.setItem("theme-preference", t);
				document.documentElement.dataset.theme = t;
				document.documentElement.classList.toggle("dark", t === "dark");
			}, theme);
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${shotsDir}/${name}-${theme}-1440.png` });
		}
	};

	await openV2(page, `/activity?range=all&q=${encodeURIComponent(title)}`);
	const main = page.getByRole("main");
	for (const n of [1, 2])
		await main.getByRole("checkbox", { name: `Select ${title} ${n}` }).check();
	await page.getByRole("button", { name: "Categorize" }).click();
	await page.getByRole("menuitem", { name: held }).click();

	// The sheet names the move and the spending it changes, before Save.
	const sheet = page.getByRole("dialog");
	await expect(
		sheet.getByText(`Move 2 expenses to ${held}`).first(),
	).toBeVisible();
	await expect(sheet.getByTestId("entry-changes")).toContainText(
		"Your spending",
	);
	await shoot("categorize-preview");

	await sheet.getByRole("button", { name: "Move" }).click();
	await expect(page.getByText(`Moved 2 expenses to ${held}`)).toBeVisible();
	const moved = await rowsOf(page, ids);
	for (const id of ids)
		expect(moved[id], id).toEqual({ categoryId: heldId, excluded: true });

	await page.getByRole("button", { name: "Undo" }).click();
	await expect
		.poll(async () => (await rowsOf(page, ids))[ids[0] ?? ""])
		.toEqual(before[ids[0] ?? ""]);
	expect(await rowsOf(page, ids)).toEqual(before);

	for (const id of ids) await post(page, "expense.deleteExpense", { id });
});
