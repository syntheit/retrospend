import { expect, test } from "@playwright/test";
import { bannedOutputOn } from "../helpers/banned-output";

// The DOM side of the banned-output check: what it reads and what it skips.
// Static pages, no server needed.

test("skips aria-hidden subtrees and user text, and restores them", async ({
	page,
}) => {
	await page.setContent(`
		<html lang="en-US"><body>
			<main>
				<h1>Activity</h1>
				<span aria-hidden="true">NaN</span>
				<div aria-hidden="true"><p>Behind a dialog: No project</p></div>
				<span data-user-text>Infinity pool</span>
				<p>Total ARS 1,200</p>
			</main>
		</body></html>`);
	expect(await bannedOutputOn(page)).toEqual([]);
	// The skipped elements are shown again afterwards.
	await expect(page.getByText("Infinity pool")).toBeVisible();
	await expect(page.locator("[data-user-text]")).not.toHaveAttribute(
		"style",
		/display/,
	);
});

test("still finds banned app text next to skipped text", async ({ page }) => {
	await page.setContent(`
		<html lang="es-AR"><body>
			<span data-user-text>Cena NaN</span>
			<p>Usado 1.250 %</p>
			<p>Martín · No project</p>
		</body></html>`);
	expect(await bannedOutputOn(page)).toEqual([
		'No project phantom: "Usado 1.250 % Martín · No project"',
		'percent above 1000%: "1.250 %"',
	]);
});
