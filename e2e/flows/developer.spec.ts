import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import {
	ADMIN_STORAGE_STATE,
	E2E_BASE_URL,
	personaStorageState,
} from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";

// Settings > Developer: API keys and webhooks on the v1 API (S3 milestone 7),
// in Sofía's saved session. The admin switch for private webhook targets
// runs in the admin's session first, so a webhook may post to this test's
// own receiver on 127.0.0.1.

test.use({ storageState: personaStorageState(SOFIA.username) });

const DEVELOPER = '[data-section="developer"]';

async function openDeveloper(page: Page) {
	await gotoReady(page, "/settings#developer");
	await expect(page.locator(DEVELOPER)).toBeVisible();
}

/** The next request a receiver gets, with its body read whole. */
function receiver() {
	const seen: { headers: IncomingMessage["headers"]; body: string }[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
			res.writeHead(204).end();
		});
	});
	return {
		seen,
		start: () =>
			new Promise<number>((resolve) =>
				server.listen(0, "127.0.0.1", () =>
					resolve((server.address() as AddressInfo).port),
				),
			),
		stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

test.describe("Developer", () => {
	test.describe.configure({ mode: "serial" });

	test("an API key: what it changes, shown once, works, then revoked", async ({
		page,
		playwright,
	}) => {
		test.setTimeout(180_000);
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await page.setViewportSize({ width: 1440, height: 900 });
		await openDeveloper(page);
		const section = page.locator(DEVELOPER);

		await section.getByRole("button", { name: "New API key" }).click();
		const sheet = page.getByRole("dialog", { name: "New API key" });
		await sheet.getByLabel("Name").fill("E2E key");
		await sheet.getByLabel("Add and change expenses").check();
		// Admin access is for admins only.
		await expect(sheet.getByLabel("Manage this server")).toHaveCount(0);
		// Before Create: what the key will be able to do, and what stays.
		const changes = sheet.getByRole("region", { name: "What this changes" });
		await expect(changes).toContainText("E2E key");
		await expect(changes).toContainText("Read, Expenses");
		await expect(changes).toContainText("your other keys");
		await sheet.getByRole("button", { name: "Create key" }).click();

		// The key shows once, with Copy.
		const reveal = page.getByRole("dialog", { name: "Your new key" });
		const key = await reveal.getByLabel("API key").inputValue();
		expect(key).toMatch(/^rsk_/);
		await expect(reveal.getByText("You won't see it again")).toBeVisible();
		// The secret step has Done only, and every way out shows the Undo toast.
		await expect(reveal.getByRole("button", { name: "Cancel" })).toHaveCount(0);
		// Escape is ignored while the create call is still finishing.
		await expect(async () => {
			await page.keyboard.press("Escape");
			await expect(page.getByText("Created E2E key")).toBeVisible({
				timeout: 1_500,
			});
		}).toPass();

		// The key reaches the API with exactly the scopes it was given.
		const api = await playwright.request.newContext({
			baseURL: E2E_BASE_URL,
			extraHTTPHeaders: { "x-api-key": key },
		});
		const me = await api.get("/api/v1/me");
		expect(me.status()).toBe(200);
		expect((await me.json()).principal.scopes).toEqual([
			"read",
			"write:expenses",
		]);
		// A scope it lacks is refused.
		const refused = await api.post("/api/v1/tokens", {
			headers: { "idempotency-key": "e2e-refused" },
			data: { name: "x", scopes: ["read"] },
		});
		expect(refused.status()).toBe(403);

		// A cookie-session write that came from another site is refused.
		const forged = await page.request.post("/api/v1/tokens", {
			headers: {
				"idempotency-key": "e2e-forged",
				"sec-fetch-site": "cross-site",
				origin: "https://evil.example",
			},
			data: { name: "forged", scopes: ["read"] },
		});
		expect(forged.status()).toBe(403);

		// The list shows the key by name, start and scopes, never the secret.
		const keys = page.getByRole("list", { name: "API keys" });
		const row = keys.getByRole("listitem").filter({ hasText: "E2E key" });
		await expect(row).toContainText("Read, Expenses");
		await expect(row).not.toContainText(key);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);

		// Revoking cannot be undone: it asks first, with a named button.
		await row.getByRole("button", { name: "More actions for E2E key" }).click();
		await page.getByRole("menuitem", { name: "Revoke key" }).click();
		const confirm = page.getByRole("alertdialog", { name: "Revoke E2E key?" });
		await expect(confirm).toContainText("stops working at once");
		// Wait for the server's answer before looking at anything else.
		const revoked = page.waitForResponse(
			(r) =>
				r.request().method() === "DELETE" &&
				/\/api\/v1\/tokens\//.test(r.url()),
		);
		await confirm.getByRole("button", { name: "Revoke key" }).click();
		expect((await revoked).status()).toBe(200);
		await expect(row).toHaveCount(0);
		expect((await api.get("/api/v1/me")).status()).toBe(401);
		await api.dispose();
		expect(errors, "uncaught page errors").toEqual([]);
	});

	test("a webhook: create, test delivery, log, turn off with Undo, delete", async ({
		page,
		browser,
	}) => {
		test.setTimeout(240_000);
		const hook = receiver();
		const port = await hook.start();

		// The admin allows private targets (it asks first), so 127.0.0.1 works.
		const adminContext = await browser.newContext({
			storageState: ADMIN_STORAGE_STATE,
			baseURL: E2E_BASE_URL,
		});
		const admin = await adminContext.newPage();
		await gotoReady(admin, "/admin");
		const switchRow = admin.getByRole("switch", {
			name: "Allow private webhook targets",
		});
		if ((await switchRow.getAttribute("aria-checked")) !== "true") {
			await switchRow.click();
			await admin
				.getByRole("alertdialog", { name: "Allow private webhook targets?" })
				.getByRole("button", { name: "Allow private targets" })
				.click();
			await expect(switchRow).toHaveAttribute("aria-checked", "true");
		}

		try {
			await page.setViewportSize({ width: 1440, height: 900 });
			await openDeveloper(page);
			const section = page.locator(DEVELOPER);
			await expect(section.getByText("No webhooks")).toBeVisible();

			await section.getByRole("button", { name: "New webhook" }).click();
			const sheet = page.getByRole("dialog", { name: "New webhook" });
			await sheet.getByLabel("Name").fill("E2E hook");
			await sheet.getByLabel("URL").fill(`http://127.0.0.1:${port}/hook?token=abc`);
			// Choose events: one resource, the last one cannot be unchecked.
			await sheet.getByRole("radio", { name: "Chosen events" }).click();
			await sheet.getByRole("checkbox", { name: "Expenses", exact: true }).check();
			const changes = sheet.getByRole("region", { name: "What this changes" });
			await expect(changes).toContainText("E2E hook");
			await expect(changes).toContainText("Expenses");
			// Only the origin is shown: a URL's path often holds a secret.
			await expect(changes).toContainText(`http://127.0.0.1:${port}`);
			await expect(changes).not.toContainText("token=abc");
			await sheet.getByRole("button", { name: "Create webhook" }).click();

			const reveal = page.getByRole("dialog", { name: "Your signing secret" });
			const secret = await reveal.getByLabel("Signing secret").inputValue();
			expect(secret.length).toBeGreaterThan(20);
			await reveal.getByRole("button", { name: "Done" }).click();

			const hooks = page.getByRole("list", { name: "Webhooks" });
			const row = hooks.getByRole("listitem").filter({ hasText: "E2E hook" });
			await expect(row).toContainText(`http://127.0.0.1:${port}`);
			await expect(row).not.toContainText("token=abc");
			await expect(row).not.toContainText(secret);

			// Test delivery: signed with the secret, logged.
			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "Send test delivery" }).click();
			await expect(page.getByText("Test delivered to E2E hook")).toBeVisible();
			expect(hook.seen).toHaveLength(1);
			const got = hook.seen[0];
			const header = String(got?.headers["retrospend-signature"] ?? "");
			const [t, v1] = header.split(",").map((p) => p.split("=")[1] ?? "");
			const expected = createHmac("sha256", secret)
				.update(`${t}.${got?.body ?? ""}`)
				.digest("hex");
			expect(v1).toBe(expected);

			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "View deliveries" }).click();
			const log = page.getByRole("dialog", { name: "Deliveries for E2E hook" });
			await expect(log.getByText("webhook.test")).toBeVisible();
			await expect(log.getByText("Delivered")).toBeVisible();
			await log.getByRole("button", { name: "Close" }).first().click();

			// Turn off, then Undo from the toast.
			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "Turn off" }).click();
			await expect(row.getByText("Off")).toBeVisible();
			await page
				.locator("[data-sonner-toast]")
				.filter({ hasText: "Turned off E2E hook" })
				.getByRole("button", { name: "Undo" })
				.click();
			await expect(row.getByText("Off")).toHaveCount(0);

			// Edit: only what changes is listed, Save ends with Undo, the secret stays.
			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "Edit webhook" }).click();
			const edit = page.getByRole("dialog", { name: "Edit E2E hook" });
			const editChanges = edit.getByRole("region", { name: "What this changes" });
			await expect(editChanges).toContainText("Nothing changed yet");
			await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
			await edit
				.getByLabel("URL", { exact: true })
				.fill(`http://127.0.0.1:${port}/hook?token=changed`);
			await edit.getByLabel("Send events to this URL").uncheck();
			await expect(editChanges).toContainText("Off");
			await expect(editChanges).toContainText("your signing secret");
			await expect(editChanges).not.toContainText("token=changed");
			const updated = page.waitForResponse(
				(r) => r.request().method() === "PATCH" && /\/api\/v1\/webhooks\//.test(r.url()),
			);
			await edit.getByRole("button", { name: "Save changes" }).click();
			expect((await updated).status()).toBe(200);
			await expect(row.getByText("Off")).toBeVisible();
			await page
				.locator("[data-sonner-toast]")
				.filter({ hasText: "Updated E2E hook" })
				.getByRole("button", { name: "Undo" })
				.click();
			await expect(row.getByText("Off")).toHaveCount(0);
			// The Undo put back the address too, not only the switch (read from the API).
			await expect(async () => {
				const listed = await page.request.get("/api/v1/webhooks");
				const mine = (await listed.json()).items.find(
					(w: { name: string }) => w.name === "E2E hook",
				);
				expect(mine.url).toBe(`http://127.0.0.1:${port}/hook?token=abc`);
				expect(mine.enabled).toBe(true);
			}).toPass();

			// Rotating the secret cannot be undone: the sheet says what changes and
			// lets the old secret keep signing for a while; the new one shows once.
			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "Rotate secret" }).click();
			const rotate = page.getByRole("dialog", {
				name: "Rotate the secret of E2E hook",
			});
			const rotateChanges = rotate.getByRole("region", { name: "What this changes" });
			// The default stops the old secret at once.
			await expect(rotateChanges).toContainText("Stops at once");
			await rotate.getByRole("radio", { name: "1 hour" }).click();
			await expect(rotateChanges).toContainText("Works for 1 hour");
			await rotate.getByRole("button", { name: "Rotate secret" }).click();
			const rotated = page.getByRole("dialog", { name: "New secret for E2E hook" });
			const next = await rotated.getByLabel("Signing secret").inputValue();
			expect(next).not.toBe(secret);
			await rotated.getByRole("button", { name: "Done" }).click();
			// The API shows the old secret signing for the hour the sheet chose.
			const listed = await page.request.get("/api/v1/webhooks");
			const mine = (await listed.json()).items.find(
				(w: { name: string }) => w.name === "E2E hook",
			);
			const left =
				new Date(mine.previousSecretExpiresAt).getTime() - Date.now();
			expect(left).toBeGreaterThan(55 * 60_000);
			expect(left).toBeLessThanOrEqual(60 * 60_000);

			// Delete asks first, then the row is gone.
			await row.getByRole("button", { name: "More actions for E2E hook" }).click();
			await page.getByRole("menuitem", { name: "Delete webhook" }).click();
			await page
				.getByRole("alertdialog", { name: "Delete E2E hook?" })
				.getByRole("button", { name: "Delete webhook" })
				.click();
			await expect(row).toHaveCount(0);
			expect(await bannedOutputOn(page), "banned output").toEqual([]);
		} finally {
			// Put the server back the way it was.
			const on = await switchRow.getAttribute("aria-checked");
			if (on === "true") {
				await switchRow.click();
				await expect(switchRow).toHaveAttribute("aria-checked", "false");
			}
			await adminContext.close();
			await hook.stop();
		}
	});

	test("the API reference is linked from Developer and renders the document", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await openDeveloper(page);
		await page
			.locator(DEVELOPER)
			.getByRole("link", { name: "Open" })
			.click();
		await expect(page).toHaveURL(/\/docs\/api$/);
		await expect(
			page.getByRole("heading", { level: 1, name: "API reference" }),
		).toBeVisible();
		await page.getByRole("link", { name: /^Webhooks/ }).first().click();
		await expect(page).toHaveURL(/\/docs\/api\/webhooks$/);
		const op = page.locator("#createWebhook");
		await op.locator("summary").click();
		await expect(op.getByText("write:settings").first()).toBeVisible();
		await expect(op.getByText("webhook.created", { exact: true })).toBeVisible();
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
	});
});
