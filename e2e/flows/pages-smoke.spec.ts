import { expect, type Page, test } from "@playwright/test";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";

// Today's pages, each with a line the seed put there, so a blank or broken
// seed fails here rather than passing on empty pages.
const PAGES: { label: string; path: string; seeded?: RegExp }[] = [
	{ label: "dashboard", path: "/dashboard" },
	{ label: "transactions", path: "/transactions" },
	{ label: "people", path: "/people", seeded: /Lucía Fernández/ },
	{ label: "projects", path: "/projects", seeded: /Viaje a Florianópolis/ },
	{ label: "wealth", path: "/wealth", seeded: /Wise \(USD\)/ },
	{ label: "budget", path: "/budget" },
	{ label: "settings", path: "/settings" },
];

async function settle(page: Page, label: string): Promise<void> {
	await page.waitForLoadState("networkidle");
	await expect(page.locator("body")).not.toHaveText(/^\s*$/);
	// An error boundary swallows the error, so pageerror alone would miss it.
	await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
	await test.info().attach(`${label}.png`, {
		body: await page.screenshot({ fullPage: true }),
		contentType: "image/png",
	});
}

test("Sofía's pages show no banned output and their figures match the API", async ({
	page,
}) => {
	// The dev server compiles each page on first visit.
	test.setTimeout(300_000);
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await loginAs(page, SOFIA.email, SOFIA.password);
	const audit = new FigureAudit(httpFigureFetcher(page.request));

	for (const { label, path, seeded } of PAGES) {
		await test.step(label, async () => {
			await page.goto(path);
			await settle(page, label);
			if (seeded) await expect(page.getByText(seeded).first()).toBeVisible();
			expect(await bannedOutputOn(page), `${label}: banned output`).toEqual([]);
			expect(await audit.checkPage(page, label), `${label}: figures`).toEqual(
				[],
			);
		});
	}

	expect(audit.crossPage(), "figures across pages").toEqual([]);
	expect(pageErrors, "uncaught page errors").toEqual([]);
});
