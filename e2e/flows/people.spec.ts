import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL, personaStorageState } from "../constants";
import {
	LUCIA,
	PROJECT_IDS,
	SEED_TIME_ZONE,
	SOFIA,
} from "../fixtures/personas";
import { expect, test } from "../fixtures/sealed-guard";
import { bannedOutputOn } from "../helpers/banned-output";
import {
	collectFigureTags,
	FigureAudit,
	type FigureFetcher,
	httpFigureFetcher,
} from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";
import { requiredFiguresFor } from "../helpers/required-figures";
import { untilSaved } from "../helpers/trpc";

// The People page on Sofía's seeded ledger: Owed to you
// and You owe as two figures (D1) that match the figures API, the groups,
// search, and Needs you (Lucía says she paid ARS 20,000 in cash): Confirm,
// then Undo puts it back. A second flow reviews a split Lucía adds: Accept
// and Reject each show what they change before Save, a save ends with Undo,
// and a share that cannot be rejected says so inline.

// Sofía's saved session; the flows project saved it (auth.setup.ts).
test.use({ storageState: personaStorageState(SOFIA.username) });

test("People: standing, groups, search, confirm a payment and undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/people");
	await expect(
		page.locator('[data-ui="v2"][data-page="people"]'),
	).toBeVisible();
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: "People", level: 1 }),
	).toBeVisible();
	const standing = main.getByRole("region", { name: "Where you stand" });
	await expect(
		standing.getByText("Owed to you", { exact: true }),
	).toBeVisible();
	await expect(standing.getByText("You owe", { exact: true })).toBeVisible();
	await expect(main.getByRole("heading", { name: /^Owe you/ })).toBeVisible();
	for (const name of ["Lucía Fernández", "Martín Acosta", "Paz Ibarra"])
		await expect(main.getByRole("link", { name })).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const audit = new FigureAudit(httpFigureFetcher(page.request));
	expect(await audit.checkPage(page, "people", "peoplePage")).toEqual([]);

	// Search folds accents; Clear filters brings everyone back.
	const search = main.getByRole("searchbox", { name: "Search people" });
	await search.fill("lucia");
	await expect(main.getByRole("link", { name: "Martín Acosta" })).toHaveCount(
		0,
	);
	await expect(
		main.getByRole("link", { name: "Lucía Fernández" }),
	).toBeVisible();
	await search.fill("zzz");
	await main.getByRole("button", { name: "Clear filters" }).click();
	await expect(main.getByRole("link", { name: "Martín Acosta" })).toBeVisible();

	// Needs you: confirm Lucía's cash payment, then undo it.
	const needs = main.getByRole("region", { name: /Needs you/ });
	const item = needs
		.getByRole("listitem")
		.filter({ hasText: "Lucía says they paid you" });
	await expect(item).toBeVisible();
	await untilSaved(page, "settlement.paymentConfirm", () =>
		item.getByRole("button", { name: "Confirm" }).click(),
	);
	const toast = page
		.locator("[data-sonner-toast]")
		.filter({ hasText: "Confirmed Lucía's payment" });
	await expect(toast).toBeVisible();
	await untilSaved(page, "settlement.paymentUnconfirm", () =>
		toast.getByRole("button", { name: "Undo" }).click(),
	);
	await expect(item).toBeVisible();
});

const SPLIT = "E2E review split";

/**
 * Lucía adds USD 40 to the Florianópolis project with Sofía (the project
 * keeps its splits waiting for review). Sofía and Lucía are square in USD
 * (Lucía's USD 40 payment settled the Lollapalooza tickets), so Sofía's USD
 * 20 is a debt she can still reject, unlike the seeded segunda casa.
 */
async function addSplitAsLucia(
	browser: Browser,
	baseURL: string | undefined,
	pool: Pool,
): Promise<string> {
	const lucia = await browser.newContext({
		storageState: personaStorageState(LUCIA.username),
		baseURL,
		timezoneId: SEED_TIME_ZONE,
	});
	try {
		const category = await pool.query<{ id: string }>(
			`SELECT id FROM category WHERE "userId" = $1 AND kind = 'EXPENSE' ORDER BY name LIMIT 1`,
			[LUCIA.id],
		);
		const today = new Intl.DateTimeFormat("en-CA", {
			timeZone: SEED_TIME_ZONE,
		}).format(new Date());
		const created = await lucia.request.post(
			"/api/trpc/entry.shared.create.save",
			{
				data: {
					json: {
						id: randomUUID(),
						amount: "40",
						currency: "USD",
						description: SPLIT,
						categoryId: category.rows[0]?.id,
						date: today,
						projectId: PROJECT_IDS.floripa,
						paidBy: { participantType: "user", participantId: LUCIA.id },
						splitMode: "EQUAL",
						splitWith: [
							{ participantType: "user", participantId: LUCIA.id },
							{ participantType: "user", participantId: SOFIA.id },
						],
					},
				},
				headers: { Origin: new URL(baseURL ?? "http://localhost").origin },
			},
		);
		expect(created.ok(), "Lucía adds the split").toBe(true);
		const body = await created.json();
		return body.result.data.json.value.id as string;
	} finally {
		await lucia.close();
	}
}

test("People: review a split with a preview, reject it, undo, and a refused reject", async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	let splitId: string | null = null;
	try {
		splitId = await addSplitAsLucia(browser, baseURL, pool);
		await gotoReady(page, "/people");
		const main = page.getByRole("main");
		const needs = main.getByRole("region", { name: /Needs you/ });
		const item = needs.getByRole("listitem").filter({ hasText: SPLIT });
		await expect(item).toBeVisible();

		// Accept's preview says nothing moves; Reject's says what falls away.
		await item.getByRole("button", { name: "Review" }).click();
		const sheet = page.getByRole("dialog", { name: "Review split" });
		const changes = sheet.getByTestId("entry-changes");
		await expect(changes).toContainText("No change to");
		await expect(sheet.getByRole("button", { name: "Accept" })).toBeEnabled();
		await sheet.getByRole("button", { name: "Reject" }).click();
		// Sofía owed USD 20 to Lucía, ARS 29,000 at the seed's 1,450 per USD, and
		// is owed far more by her in every other currency, so rejecting lowers
		// what Lucía owes back: Owed to you rises by ARS 29,000 (minor 2,900,000).
		// Her share is no longer her spending: USD 20 (ARS 29,000) less spent,
		// ARS 29,000 more left to spend.
		await expect(changes).toContainText("Owed to you");
		await expect(changes).toContainText("+$29,000");
		await expect(changes).toContainText("-$29,000");
		const hand: Record<string, { minor: number; currency: string }> = {
			"preview.owed.owedToYou.delta": { minor: 2_900_000, currency: "ARS" },
			"preview.glance.spent.delta": { minor: -2_900_000, currency: "ARS" },
			"preview.spent.delta": { minor: -2_000, currency: "USD" },
			"preview.budget.leftToSpend.delta": { minor: 2_900_000, currency: "ARS" },
		};
		const byHand: FigureFetcher = async (ids) => ({
			figures: ids.flatMap((id) => {
				const m = hand[id];
				return m ? [{ id, unit: "money" as const, ...m }] : [];
			}),
			missing: ids.filter((id) => !hand[id]),
		});
		const rendered = await collectFigureTags(page);
		expect(
			await new FigureAudit(byHand).checkRendered(
				"reviewReject",
				{
					...rendered,
					tags: rendered.tags.filter((t) => t.id?.endsWith(".delta")),
				},
				requiredFiguresFor("reviewReject"),
			),
		).toEqual([]);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
		await sheet
			.getByRole("textbox", { name: "Reason (optional)" })
			.fill("No es mío");
		await untilSaved(page, "verification.answer.save", () =>
			sheet.getByRole("button", { name: "Reject" }).click(),
		);
		await expect(sheet).toBeHidden();
		const toast = page
			.locator("[data-sonner-toast]")
			.filter({ hasText: `Rejected ${SPLIT}` });
		await expect(toast).toBeVisible();
		await expect(item).toHaveCount(0);
		// The figures on screen are the API's, after the reject.
		const audit = new FigureAudit(httpFigureFetcher(page.request));
		expect(await audit.checkPage(page, "people", "peoplePage")).toEqual([]);

		// Undo puts the share back: it waits for review again.
		await untilSaved(page, "verification.restoreAnswer.save", () =>
			toast.getByRole("button", { name: "Undo" }).dispatchEvent("click"),
		);
		await expect(item).toBeVisible();
		const back = new FigureAudit(httpFigureFetcher(page.request));
		expect(await back.checkPage(page, "people", "peoplePage")).toEqual([]);

		// The seeded segunda casa was paid for: Reject says so inline and cannot save.
		const second = needs
			.getByRole("listitem")
			.filter({ hasText: "Hospedagem, segunda casa" });
		await second.getByRole("button", { name: "Review" }).click();
		await sheet.getByRole("button", { name: "Reject" }).click();
		await expect(changes).toContainText(
			"You already paid this share, so use Ask to fix instead.",
		);
		await expect(sheet.getByRole("button", { name: "Reject" })).toBeDisabled();
		// There is nothing to explain to Lucía, so the reason box is gone too.
		await expect(
			sheet.getByRole("textbox", { name: "Reason (optional)" }),
		).toHaveCount(0);
		await sheet.getByRole("button", { name: "Back" }).click();
		await expect(changes).toContainText("No change to");
		await expect(sheet.getByRole("button", { name: "Accept" })).toBeEnabled();
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
	} finally {
		if (splitId)
			await pool.query(`DELETE FROM shared_transaction WHERE id = $1`, [
				splitId,
			]);
		await pool.end();
	}
});
