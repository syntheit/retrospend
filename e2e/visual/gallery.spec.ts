import { expect, type Page, test } from "@playwright/test";
import { SECTIONS } from "../../src/app/dev/components/sections";
import { loginAsAdmin } from "../helpers/auth";
import { gotoReady } from "../helpers/navigation";
import {
	contextFor,
	shotName,
	THEMES,
	useTheme,
	WIDTHS,
	type Width,
} from "./matrix";

// The gallery scrolls inside its own h-dvh box, which would clip a section
// taller than the viewport. Let the document grow instead, so each
// section screenshot holds the whole section.
const UNBOX_GALLERY = `div.h-dvh:has(> main) { height: auto !important; overflow: visible !important; }`;

/**
 * The gallery's static menus are real open dropdowns, portaled and placed
 * against the viewport. Scrolled out of view, they flip above their anchor,
 * and when they move depends on scroll timing. A viewport as tall as the page
 * never scrolls, so every menu sits where the owner saw it. Only the height
 * changes; the layout follows the width.
 */
async function fitViewportToPage(page: Page, width: Width): Promise<void> {
	const height = await page.evaluate(
		() => document.documentElement.scrollHeight,
	);
	await page.setViewportSize({ width, height });
	// Settled once two reads a few frames apart agree.
	await expect
		.poll(async () => {
			const before = await page.evaluate(menuPlacement);
			await page.evaluate(
				() =>
					new Promise((done) =>
						requestAnimationFrame(() => requestAnimationFrame(done)),
					),
			);
			return before === (await page.evaluate(menuPlacement));
		})
		.toBe(true);
}

/** Where every portaled menu sits, as one comparable string. */
function menuPlacement(): string {
	return [...document.querySelectorAll("[data-radix-popper-content-wrapper]")]
		.map((el) => {
			const r = el.getBoundingClientRect();
			return `${r.x},${r.y}`;
		})
		.join(";");
}

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		test.describe(`gallery ${theme} ${width}`, () => {
			test.use(contextFor(width, theme));

			test("every section matches its baseline", async ({ page }) => {
				test.setTimeout(240_000);
				await useTheme(page, theme);
				await loginAsAdmin(page);
				await gotoReady(page, "/dev/components");
				await expect
					.poll(() =>
						page.evaluate(() =>
							document.documentElement.classList.contains("dark"),
						),
					)
					.toBe(theme === "dark");
				await page.addStyleTag({ content: UNBOX_GALLERY });
				await page.evaluate(() => document.fonts.ready);
				await fitViewportToPage(page, width);

				// Every section in sections.ts gets a shot, so a new section
				// fails here until its baseline is added on purpose.
				for (const { id } of SECTIONS) {
					await test.step(id, async () => {
						await expect
							.soft(page.locator(`section#${id}`))
							.toHaveScreenshot(shotName("gallery", id, theme, width));
					});
				}
			});
		});
	}
}
