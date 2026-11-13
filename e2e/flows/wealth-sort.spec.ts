import { expect, type Page, test } from "../fixtures/sealed-guard";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// Wealth sorting (Spotify's model) and the chart scrub, on Sofía's seeded
// accounts: the custom order is saved on the server, so it survives a
// reload and a trip through another sort. The flows project.

test.use({ storageState: personaStorageState(SOFIA.username) });

async function openWealth(page: Page): Promise<void> {
	await gotoReady(page, "/wealth");
	await expect(
		page.locator('[data-ui="v2"][data-page="wealth"]'),
	).toBeVisible();
}

async function pickSort(page: Page, name: string): Promise<void> {
	const main = page.getByRole("main");
	await main.getByRole("button", { name: /^Sort:/ }).click();
	await page.getByRole("menuitemradio", { name }).click();
}

/** The names of the rows in one group, top to bottom. */
async function names(page: Page, group: string): Promise<string[]> {
	const rows = page.getByRole("main").getByRole("list", { name: group });
	return rows
		.getByRole("listitem")
		.evaluateAll((items) =>
			items.map(
				(li) =>
					li
						.querySelector("a, button:not([aria-label^='Reorder'])")
						?.textContent?.trim() ?? "",
			),
		);
}

test("Wealth: a custom order is saved, and another sort in between does not touch it", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWealth(page);
	const main = page.getByRole("main");
	const group = "Cash and bank";

	// Custom: the rows get a grip. Move the first row down with the keyboard.
	await untilSaved(page, "wealth.accounts.setOrder", () =>
		pickSort(page, "Custom order"),
	);
	await expect(main.getByRole("button", { name: /^Sort:/ })).toContainText(
		"Custom order",
	);
	const start = await names(page, group);
	expect(start.length).toBeGreaterThan(2);
	const first = start[0] ?? "";
	const grip = main
		.getByRole("list", { name: group })
		.getByRole("button", { name: `Reorder ${first}` });
	await grip.focus();
	// The screen reader hears each step; the test waits for them too.
	const heard = page.locator("[aria-live]").first();
	await page.keyboard.press("Space");
	await expect(heard).toContainText(`${first} moved to position 1`);
	await page.keyboard.press("ArrowDown");
	await expect(heard).toContainText(`${first} moved to position 2`);
	await untilSaved(page, "wealth.accounts.setOrder", () =>
		page.keyboard.press("Space"),
	);
	const custom = await names(page, group);
	expect(custom).not.toEqual(start);
	expect(custom[1]).toBe(first);

	// Name sorts A to Z, and no grip shows outside Custom.
	await untilSaved(page, "wealth.accounts.setOrder", () =>
		pickSort(page, "Name"),
	);
	const byName = await names(page, group);
	expect(byName).toEqual(
		[...byName].sort((a, b) =>
			a.localeCompare(b, "en", { sensitivity: "base" }),
		),
	);
	await expect(main.getByRole("button", { name: /^Reorder / })).toHaveCount(0);

	// Back to Custom: exactly the order it was.
	await untilSaved(page, "wealth.accounts.setOrder", () =>
		pickSort(page, "Custom order"),
	);
	expect(await names(page, group)).toEqual(custom);

	// The mode and the order outlive a reload.
	await page.reload();
	await expect(main.getByRole("button", { name: /^Sort:/ })).toContainText(
		"Custom order",
	);
	expect(await names(page, group)).toEqual(custom);

	// Put the seeded view back for the other flows.
	await untilSaved(page, "wealth.accounts.setOrder", () =>
		pickSort(page, "Value"),
	);
});

test("Wealth: the chart scrubs with the arrow keys and shows the day and the value", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWealth(page);
	const main = page.getByRole("main");
	const chart = main.getByRole("slider");
	const hero = main.getByText("Net worth", { exact: true });
	await expect(hero).toBeVisible();
	const before = await main.locator("#nw-label + div + div").textContent();

	await chart.focus();
	await page.keyboard.press("ArrowLeft");
	// The hero now reads that day: the date replaces the 30-day change.
	await expect(chart).toHaveAttribute("aria-valuetext", /: /);
	const during = await main.locator("#nw-label + div + div").textContent();
	expect(during).not.toBe(before);

	await page.keyboard.press("Escape");
	await expect(main.locator("#nw-label + div + div")).toHaveText(before ?? "");
});
