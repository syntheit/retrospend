import { expect, type Page, test } from "@playwright/test";
import { gotoReady } from "../../helpers/navigation";
import { openPage, SOFIA_SESSION } from "./projects-helpers";

// The phone sheet's footer stays on screen: vaul moves the sheet down by the
// part of the screen above its detent, so the sheet's column must end at the
// bottom of the screen, not that far below it. Opened from two pages that
// reported the primary button below the screen at 390x844, and the
// gallery's medium detent sample.

test.use({ storageState: SOFIA_SESSION });

const PHONES = [
	{ width: 390, height: 844 },
	{ width: 375, height: 667 },
];

const SHEETS = [
	{
		path: "/wealth",
		label: "wealth",
		open: "Add account",
		submit: "Add account",
	},
	{
		path: "/projects",
		label: "projects",
		open: "New project",
		submit: "Create project",
	},
];

/** Where each detent's top edge sits, as a share of the screen height. */
const DETENT_TOP = { large: 0.06, medium: 0.48 };

async function expectFooterOnScreen(
	page: Page,
	dialog: string,
	submit: string,
	detent: keyof typeof DETENT_TOP = "large",
) {
	const sheet = page.getByRole("dialog", { name: dialog });
	await expect(sheet).toHaveAttribute("data-detent", detent);
	const button = sheet.getByRole("button", { name: submit, exact: true });
	await expect(button).toBeInViewport({ ratio: 1 });
	const view = page.viewportSize();
	if (!view) throw new Error("no viewport");
	// The slide in has finished once the button stops above the bottom edge.
	await expect
		.poll(async () => {
			const b = await button.boundingBox();
			return b ? b.y + b.height <= view.height && b.y >= 0 : false;
		})
		.toBe(true);
	// The detent shows the kit's 94% or 52% of the screen, no less.
	const top = (await sheet.boundingBox())?.y ?? -1;
	expect(top).toBeGreaterThan(view.height * (DETENT_TOP[detent] - 0.02));
	expect(top).toBeLessThan(view.height * (DETENT_TOP[detent] + 0.02));
}

for (const phone of PHONES) {
	for (const s of SHEETS) {
		test(`Sheet footer on screen: ${s.open} at ${phone.width}x${phone.height}`, async ({
			page,
		}) => {
			test.setTimeout(90_000);
			await page.setViewportSize(phone);
			await openPage(page, s.path, s.label);
			await page.getByRole("button", { name: s.open }).first().click();
			await expectFooterOnScreen(page, s.open, s.submit);
		});
	}
}

test("Sheet footer on screen: the gallery's medium detent at 390x844", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await gotoReady(page, "/dev/components");
	await page
		.locator("#sheet")
		.getByRole("button", { name: "Open" })
		.nth(1)
		.click();
	await expectFooterOnScreen(page, "Settle up", "Record", "medium");
});
