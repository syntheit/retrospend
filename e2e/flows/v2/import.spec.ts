import { expect, type Page, test } from "@playwright/test";
import { USER_STORAGE_STATE } from "../../constants";
import { bannedOutputOn } from "../../helpers/banned-output";
import { FigureAudit, type FiguresResponse } from "../../helpers/figures";
import { untilSaved } from "../../helpers/trpc";
import { openV2 } from "./viewer";

type Money = { minor: number; currency: string };
type Review = {
	rows: { index: number; amount: Money; home: Money | null }[];
};
type Recent = { id: string; state: string; count: number }[];

/**
 * The blank e2e account (USD home), whom no other v2 flow uses: the rows
 * this flow imports touch nobody else's figures, and its Undo takes them
 * back out.
 */
test.use({ storageState: USER_STORAGE_STATE });

const day = (offset: number) =>
	new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

/** A Retrospend CSV with a kind column: five rows and one without a date. */
const CSV = [
	"date,title,amount,currency,category,kind",
	`${day(1)},Cafe Martinez,3500,ARS,Gastro,expense`,
	`${day(2)},Amazon order,63.40,USD,Compras,expense`,
	`${day(3)},Salary October,850000,ARS,,income`,
	`${day(3)},Shoe refund,12000,ARS,,refund`,
	`${day(4)},To savings,100000,ARS,,not spending`,
	",Seguro auto,12800,ARS,Seguros,expense",
].join("\n");

async function get<T>(page: Page, path: string, input?: unknown): Promise<T> {
	const q = input
		? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
		: "";
	const res = await page.request.get(`/api/trpc/${path}${q}`);
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

/** The audit's API side: importQueue.review, as the page reads it. */
function reviewFetcher(page: Page, jobId: string) {
	return async (ids: string[]): Promise<FiguresResponse> => {
		const view = await get<Review>(page, "importQueue.review", {
			jobId,
			currency: null,
		});
		const byId = new Map<string, Money>();
		for (const r of view.rows) {
			byId.set(`import.amount:${r.index}`, r.amount);
			if (r.home) byId.set(`import.home:${r.index}`, r.home);
		}
		const figures = ids.flatMap((id) => {
			const m = byId.get(id);
			return m
				? [{ id, unit: "money" as const, minor: m.minor, currency: m.currency }]
				: [];
		});
		return { figures, missing: ids.filter((id) => !byId.has(id)) };
	};
}

test("Import: a CSV is read, reviewed with kinds, matched, imported and undone", async ({
	page,
}) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));

	await openV2(page, "/import");
	const main = page.getByRole("main");
	await expect(main.getByRole("heading", { name: "Import" })).toBeVisible();
	await expect(main.getByTestId("import-drop")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// The fast path: a Retrospend CSV skips "Read it" and opens the review.
	await main.getByTestId("import-file").setInputFiles({
		name: "galicia-oct.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(CSV),
	});
	const review = main.getByTestId("import-review");
	await expect(review).toBeVisible({ timeout: 60_000 });
	const counts = main.getByTestId("import-counts");
	// 5 readable rows + 1 the reader could not read = 6 in the file.
	await expect(counts).toContainText("6 rows in the file: 5 to import");
	await expect(counts).toContainText("1 skipped");

	// Kinds are proposed from the file.
	const rows = main.locator("tr[data-index]");
	await expect(rows).toHaveCount(5);
	await expect(rows.nth(2).locator("[data-kind]")).toHaveAttribute(
		"data-kind",
		"income",
	);
	await expect(rows.nth(3).locator("[data-kind]")).toHaveAttribute(
		"data-kind",
		"refund",
	);
	await expect(rows.nth(4).locator("[data-kind]")).toHaveAttribute(
		"data-kind",
		"notSpending",
	);

	// Every amount on screen is the server's, original and home value.
	const recent = await get<Recent>(page, "importQueue.recent");
	const job = recent.find((j) => j.state === "review");
	expect(job, "the job waits for review").toBeTruthy();
	const audit = new FigureAudit(reviewFetcher(page, job?.id ?? ""));
	expect(await audit.checkPage(page, "import")).toEqual([]);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// Match categories: one sheet for both names, created as real categories.
	await main.getByRole("button", { name: "Match categories" }).click();
	const match = page.getByRole("dialog", { name: "Match categories" });
	await expect(match).toBeVisible();
	await expect(match.locator("[data-match]")).toHaveCount(2);
	await match.getByRole("button", { name: "Apply" }).click();
	await expect(match).toBeHidden();
	await expect(page.getByText(/Matched 2 categories, created/)).toBeVisible();
	await expect(
		main.getByRole("button", { name: "Match categories" }),
	).toHaveCount(0);

	// Import previews the commit: what it creates per kind, what it skips.
	await main.getByRole("button", { name: "Import 5 rows" }).click();
	const sheet = page.getByRole("dialog", { name: "Import galicia-oct.csv" });
	await expect(sheet).toBeVisible();
	const summary = sheet.getByTestId("import-summary");
	await expect(summary).toContainText("2 expenses");
	await expect(summary).toContainText("1 income");
	await expect(summary).toContainText("1 refund");
	await expect(summary).toContainText("1 not spending");
	await expect(summary).toContainText(
		"6 rows in the file: 5 imported, 1 skipped",
	);
	await expect(sheet.getByTestId("entry-changes")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	await untilSaved(page, "importQueue.commit", () =>
		sheet.getByRole("button", { name: "Import 5 rows" }).click(),
	);
	const done = main.getByTestId("import-done");
	await expect(done).toContainText("Imported 5 rows");
	const imported = await get<Recent>(page, "importQueue.recent");
	expect(imported.find((j) => j.id === job?.id)).toMatchObject({
		state: "imported",
		count: 5,
	});

	// Undo import takes the whole batch back; the file is reviewable again.
	await untilSaved(page, "importQueue.undo", () =>
		done.getByRole("button", { name: "Undo import" }).click(),
	);
	await expect(review).toBeVisible();
	await expect(counts).toContainText("5 to import");
	const after = await get<Recent>(page, "importQueue.recent");
	expect(after.find((j) => j.id === job?.id)?.state).toBe("review");

	expect(errors).toEqual([]);
});
