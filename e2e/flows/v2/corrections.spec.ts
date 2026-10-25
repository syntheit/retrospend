import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL, personaStorageState } from "../../constants";
import { LUCIA, MARTIN, SEED_TIME_ZONE } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { untilSaved } from "../../helpers/trpc";
import { openV2 } from "./viewer";

// Ask to fix, Respond and Correct (4G, MONEY-MOVES 1.11) on a split of their
// own: Martín adds "E2E fix dinner" with Lucía. Lucía (who reads the app in
// Spanish) asks him to fix it and takes the request back with Undo. Martín
// declines and undoes that, then a payment settles the split (the lock is
// written straight into the table: settling it for real would move the
// seeded balances other flows read) and he accepts, corrects the total and
// undoes the correction, which puts his accepted request back.

test.use({ storageState: personaStorageState(MARTIN.username) });

const TITLE = "E2E fix dinner";

// Undo is clicked by event: the dev server's badge sits over a toast's corner.

const today = () =>
	new Intl.DateTimeFormat("en-CA", { timeZone: SEED_TIME_ZONE }).format(
		new Date(),
	);

async function openRow(page: Page, title = TITLE) {
	await openV2(page, "/activity?range=all");
	await page.getByRole("main").getByText(title).first().click();
	const read = page.getByRole("dialog", { name: title });
	await expect(read).toBeVisible();
	return read;
}

/** Martín adds an even 64,000 split with Lucía through the app and returns its id. */
async function addSplit(page: Page, pool: Pool, title: string) {
	await openV2(page, "/activity");
	const category = await pool.query<{ id: string }>(
		`SELECT id FROM category WHERE "userId" = $1 AND kind = 'EXPENSE' ORDER BY name LIMIT 1`,
		[MARTIN.id],
	);
	const created = await page.request.post(
		"/api/trpc/entry.shared.create.save",
		{
			data: {
				json: {
					id: randomUUID(),
					amount: "64000",
					currency: "ARS",
					description: title,
					categoryId: category.rows[0]?.id,
					date: today(),
					paidBy: { participantType: "user", participantId: MARTIN.id },
					splitMode: "EQUAL",
					splitWith: [
						{ participantType: "user", participantId: MARTIN.id },
						{ participantType: "user", participantId: LUCIA.id },
					],
				},
			},
			headers: { Origin: new URL(page.url()).origin },
		},
	);
	expect(created.ok(), "add the split").toBe(true);
	const body = await created.json();
	return body.result.data.json.value.id as string;
}

/** Takes the split, its requests and its corrections out, so no other flow sees them. */
async function cleanUp(pool: Pool, id: string | null) {
	if (id) {
		await pool.query(`DELETE FROM fix_request WHERE "transactionId" = $1`, [
			id,
		]);
		await pool.query(
			`DELETE FROM shared_transaction WHERE id = $1 OR "correctsId" = $1`,
			[id],
		);
	}
	await pool.end();
}

test("Corrections: ask, respond, correct, undo", async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(240_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	let rowId: string | null = null;
	try {
		rowId = await addSplit(page, pool, TITLE);

		// Lucía asks Martín to fix it, then takes it back with Undo, then asks again.
		const lucia = await browser.newContext({
			storageState: personaStorageState(LUCIA.username),
			baseURL,
			locale: "en-US",
			timezoneId: SEED_TIME_ZONE,
			viewport: { width: 1440, height: 900 },
		});
		const luciaPage = await lucia.newPage();
		let read = await openRow(luciaPage);
		await expect(read).toContainText("ARS 64.000");
		await read
			.getByRole("button", { name: "Pedirle a Martín que lo corrija" })
			.click();
		const ask = luciaPage.getByRole("dialog", {
			name: "Pedirle a Martín que lo corrija",
		});
		await expect(ask.getByRole("button", { name: "Enviar" })).toBeEnabled();
		await ask.getByRole("textbox").fill("Eran tres platos, no cuatro");
		await expect(ask.getByTestId("entry-changes")).toContainText("Sin cambios");
		expect(await bannedOutputOn(luciaPage), "banned output").toEqual([]);
		await untilSaved(luciaPage, "corrections.askToFix.save", () =>
			ask.getByRole("button", { name: "Enviar" }).click(),
		);
		const sent = luciaPage
			.locator("[data-sonner-toast]")
			.filter({ hasText: `Le pediste a Martín que corrija ${TITLE}` });
		await untilSaved(luciaPage, "corrections.withdrawFix.save", () =>
			sent.getByRole("button", { name: "Deshacer" }).dispatchEvent("click"),
		);
		read = await openRow(luciaPage);
		await expect(
			read.getByRole("button", { name: "Pedirle a Martín que lo corrija" }),
		).toBeVisible();
		await read
			.getByRole("button", { name: "Pedirle a Martín que lo corrija" })
			.click();
		const again = luciaPage.getByRole("dialog", {
			name: "Pedirle a Martín que lo corrija",
		});
		await again.getByRole("textbox").fill("Eran tres platos, no cuatro");
		await expect(again.getByTestId("entry-changes")).toContainText(
			"Sin cambios",
		);
		await untilSaved(luciaPage, "corrections.askToFix.save", () =>
			again.getByRole("button", { name: "Enviar" }).click(),
		);
		// Her read view now says she asked, and offers to cancel.
		read = await openRow(luciaPage);
		await expect(
			read.getByText(/Le pediste a Martín que lo corrija/),
		).toBeVisible();
		await expect(
			read.getByRole("button", { name: "Cancelar pedido" }),
		).toBeVisible();
		await lucia.close();

		// Martín finds the request in Needs you on Home, and Respond opens the split.
		await openV2(page, "/home");
		const card = page
			.getByRole("region", { name: /^Needs you/ })
			.getByRole("listitem")
			.filter({ hasText: `Lucía asked you to fix ${TITLE}` });
		await expect(card).toBeVisible();
		await card.getByRole("button", { name: "Respond" }).click();
		await expect(page.getByRole("dialog", { name: TITLE })).toBeVisible();
		await page.keyboard.press("Escape");

		// Martín answers: Decline, Undo, then the row still asks him to respond.
		read = await openRow(page);
		await expect(read.getByText("Lucía asked you to fix this.")).toBeVisible();
		await read.getByRole("button", { name: "Respond" }).click();
		const respond = page.getByRole("dialog", {
			name: "Lucía asked you to fix this",
		});
		await expect(respond).toContainText("Eran tres platos, no cuatro");
		await expect(respond.getByTestId("entry-changes")).toContainText(
			"No change to",
		);
		await respond.getByRole("textbox").fill("Fue un error mío");
		await untilSaved(page, "corrections.respondToFix.save", () =>
			respond.getByRole("button", { name: "Decline" }).click(),
		);
		await untilSaved(page, "corrections.restoreFix.save", () =>
			page
				.locator("[data-sonner-toast]")
				.filter({ hasText: "Declined Lucía" })
				.getByRole("button", { name: "Undo" })
				.dispatchEvent("click"),
		);
		read = await openRow(page);
		await expect(read.getByRole("button", { name: "Respond" })).toBeVisible();
		await read.getByRole("button", { name: "Close" }).first().click();

		// A payment settles the split: it is locked and Correct is the way to change it.
		await pool.query(
			`UPDATE shared_transaction
			    SET "isLocked" = true,
			        "lockedByPaymentId" = (SELECT id FROM payment ORDER BY "createdAt" LIMIT 1)
			  WHERE id = $1`,
			[rowId],
		);
		read = await openRow(page);
		await expect(read.getByText("A payment settled this expense")).toHaveCount(
			0,
		);
		await read.getByRole("button", { name: "Respond" }).click();
		await page
			.getByRole("dialog", { name: "Lucía asked you to fix this" })
			.getByRole("button", { name: "Accept" })
			.click();
		const correct = page.getByRole("dialog", { name: `Correct ${TITLE}` });
		await expect(correct).toBeVisible();
		const record = correct.getByRole("button", { name: "Record correction" });
		await expect(record).toBeDisabled();
		await correct.getByRole("textbox", { name: "Amount" }).fill("48000");
		const changes = correct.getByTestId("entry-changes");
		// 64,000 to 48,000: each of the two shares drops by 8,000 and Martín paid 16,000 less.
		await expect(changes).toContainText("Your share");
		await expect(changes).toContainText("-ARS 8,000");
		await expect(changes).toContainText("You paid");
		await expect(changes).toContainText("-ARS 16,000");
		await expect(changes).toContainText("Lucía's share");
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
		await expect(record).toBeEnabled();
		await untilSaved(page, "corrections.correct.save", () => record.click());
		await expect(correct).toBeHidden();
		const done = page
			.locator("[data-sonner-toast]")
			.filter({ hasText: `Correction recorded on ${TITLE}` });
		await expect(done).toBeVisible();
		await expect(
			page.getByRole("main").getByText(`Correction to ${TITLE}`),
		).toBeVisible();
		await untilSaved(page, "corrections.undoCorrection.save", () =>
			done.getByRole("button", { name: "Undo" }).dispatchEvent("click"),
		);
		await expect(
			page.getByRole("main").getByText(`Correction to ${TITLE}`),
		).toHaveCount(0);

		// The undo put his accepted request back: Correct is still what he is asked for.
		read = await openRow(page);
		await expect(read.getByText(/You said you would fix this/)).toBeVisible();
		await expect(read.getByRole("button", { name: "Correct" })).toBeVisible();
	} finally {
		await cleanUp(pool, rowId);
	}
});

test("Corrections: accepting on an open split opens Edit, and saving answers the request", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	const title = "E2E fix lunch";
	let rowId: string | null = null;
	try {
		rowId = await addSplit(page, pool, title);
		// Lucía's request, written as she would send it (her sheets are covered above).
		await pool.query(
			`INSERT INTO fix_request (id, "transactionId", "requestedByType", "requestedById", "askedType", "askedId", message)
			 VALUES ($1, $2, 'user', $3, 'user', $4, $5)`,
			[randomUUID(), rowId, LUCIA.id, MARTIN.id, "Eran dos platos"],
		);

		const read = await openRow(page, title);
		await expect(read.getByText("Lucía asked you to fix this.")).toBeVisible();
		await read.getByRole("button", { name: "Respond" }).click();
		await page
			.getByRole("dialog", { name: "Lucía asked you to fix this" })
			.getByRole("button", { name: "Accept" })
			.click();
		// Not settled: Accept opens the plain edit sheet, not Correct.
		const edit = page.getByRole("dialog", { name: "Edit shared expense" });
		await expect(edit).toBeVisible();
		await edit.getByRole("textbox", { name: "Amount" }).fill("50000");
		await untilSaved(page, "entry.shared.update.save", () =>
			edit.getByRole("button", { name: "Save" }).click(),
		);
		await expect(edit).toBeHidden();
		const status = await pool.query<{ status: string }>(
			`SELECT status FROM fix_request WHERE "transactionId" = $1`,
			[rowId],
		);
		expect(status.rows.map((r) => r.status)).toEqual(["FIXED"]);
	} finally {
		await cleanUp(pool, rowId);
	}
});
