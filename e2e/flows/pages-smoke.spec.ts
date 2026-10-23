import { expect, type Page, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { LUCIA, SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";

interface SmokePage {
	key: string;
	path: string;
	/** A line the seed put there, so a blank or broken seed fails here. */
	seeded?: RegExp;
}

const PATHS: Record<string, string> = {
	dashboard: "/dashboard",
	transactions: "/transactions",
	people: "/people",
	projects: "/projects",
	wealth: "/wealth",
	budget: "/budget",
	settings: "/settings",
};

function smokePages(seeded: Record<string, RegExp>): SmokePage[] {
	return Object.entries(PATHS).map(([key, path]) => ({
		key,
		path,
		seeded: seeded[key],
	}));
}

/** The error boundary's heading in every language the passes use. */
const ERROR_BOUNDARY = /Something went wrong|Algo salió mal/;

/**
 * Visits every page in the signed-in persona's session (auth.setup.ts): no
 * banned output, no error boundary, no uncaught error, and the figures
 * match the API.
 */
async function walkPages(
	page: Page,
	pages: SmokePage[],
	variant: string,
): Promise<void> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const audit = new FigureAudit(httpFigureFetcher(page.request));

	for (const { key, path, seeded } of pages) {
		const label = `${variant} ${key}`;
		await test.step(label, async () => {
			await gotoReady(page, path);
			const main = page.getByRole("main");
			await expect(main).not.toHaveText(/^\s*$/);
			// An error boundary swallows the error, so pageerror alone would miss it.
			await expect(page.getByText(ERROR_BOUNDARY)).toHaveCount(0);
			if (seeded) await expect(main.getByText(seeded).first()).toBeVisible();
			await test.info().attach(`${label}.png`, {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			expect(await bannedOutputOn(page), `${label}: banned output`).toEqual([]);
			expect(
				await audit.checkPage(page, label, key),
				`${label}: figures`,
			).toEqual([]);
		});
	}

	expect(audit.crossPage(), "figures across pages").toEqual([]);
	expect(pageErrors, "uncaught page errors").toEqual([]);
}

test.describe("en at 1440", () => {
	test.use({ storageState: personaStorageState(SOFIA.username) });

	test("Sofía's pages at 1440 in English", async ({ page }) => {
		// The dev server compiles each page on first visit.
		test.setTimeout(300_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await walkPages(
			page,
			smokePages({
				people: /Lucía Fernández/,
				projects: /Viaje a Florianópolis/,
				wealth: /Wise \(USD\)/,
			}),
			"en 1440",
		);
	});
});

test.describe("es-AR at 390", () => {
	test.use({
		locale: "es-AR",
		viewport: { width: 390, height: 844 },
		storageState: personaStorageState(LUCIA.username),
	});

	test("Lucía's pages at 390 in Spanish", async ({ page }) => {
		test.setTimeout(300_000);
		await walkPages(
			page,
			smokePages({
				people: /Sofía Reyes/,
				projects: /Viaje a Florianópolis/,
			}),
			"es-AR 390",
		);
		await expect(page.locator("html")).toHaveAttribute("lang", "es-AR");
	});
});
