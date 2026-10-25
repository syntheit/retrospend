import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { E2E_BASE_URL, USER_STORAGE_STATE } from "../constants";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { contextFor, THEMES, useTheme, WIDTHS } from "../visual/matrix";

// A project page opened without an account on it: through a viewer link, an
// invite that makes a guest, and the public page of a public project. The
// blank test user owns a project made for this file and deletes it at the end.
// The guests sign nobody in (guest.register), so the sign-in limit is not used.

test.describe.configure({ mode: "serial" });

const PROJECT = "E2E Guest Trip";
const NO_SESSION = { cookies: [], origins: [] };

type Ids = { project: string; viewerLink: string; guestLink: string };
const ids: Ids = { project: "", viewerLink: "", guestLink: "" };
/** What the browser keeps for the guest (src/trpc/react.tsx reads it), for the screenshots. */
let guestStorage: Record<string, string> = {};
let owner: APIRequestContext;

async function trpc<T>(
	path: string,
	input: unknown,
	meta?: unknown,
): Promise<T> {
	const res = await owner.post(`/api/trpc/${path}`, {
		headers: { Origin: E2E_BASE_URL, "content-type": "application/json" },
		data: { json: input, ...(meta ? { meta } : {}) },
	});
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

test.beforeAll(async ({ playwright }) => {
	test.setTimeout(120_000);
	owner = await playwright.request.newContext({
		baseURL: E2E_BASE_URL,
		storageState: USER_STORAGE_STATE,
	});
	const project = await trpc<{ id: string }>("project.create", {
		name: PROJECT,
		primaryCurrency: "USD",
	});
	ids.project = project.id;
	const nico = await trpc<{ participantType: "shadow"; participantId: string }>(
		"people.createShadow",
		{ name: "Nico" },
	);
	await trpc("project.addParticipant", {
		projectId: ids.project,
		participantType: nico.participantType,
		participantId: nico.participantId,
		role: "CONTRIBUTOR",
	});
	const me = await (await owner.get("/api/auth/get-session")).json();
	const self = { participantType: "user", participantId: me.user.id };
	await trpc(
		"sharedTransaction.create",
		{
			amount: 90,
			currency: "USD",
			description: "Dinner",
			date: new Date().toISOString(),
			paidBy: self,
			splitWith: [
				self,
				{
					participantType: nico.participantType,
					participantId: nico.participantId,
				},
			],
			splitMode: "EQUAL",
			projectId: ids.project,
		},
		{ values: { date: ["Date"] } },
	);
	ids.viewerLink = (
		await trpc<{ id: string }>("project.createMagicLink", {
			projectId: ids.project,
			roleGranted: "VIEWER",
		})
	).id;
	ids.guestLink = (
		await trpc<{ id: string }>("project.createMagicLink", {
			projectId: ids.project,
			roleGranted: "CONTRIBUTOR",
		})
	).id;
});

test.afterAll(async () => {
	if (ids.project) await trpc("project.delete", { id: ids.project });
	await owner.dispose();
});

async function openShared(page: Page, path: string): Promise<void> {
	await gotoReady(page, path);
	await expect(page.locator('[data-page="project-shared"]')).toBeVisible();
}

test.describe("a viewer link", () => {
	test.use({ storageState: NO_SESSION });

	test("shows the project read only, with no balances and no way to add", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await openShared(page, `/projects/${ids.project}?invite=${ids.viewerLink}`);
		const main = page.getByRole("main");
		await expect(
			main.getByRole("heading", { name: PROJECT, level: 1 }),
		).toBeVisible();
		await expect(main.getByText("Dinner")).toBeVisible();
		await expect(main.getByRole("status")).toContainText("View only");
		await expect(main.getByRole("link", { name: "Sign in" })).toBeVisible();
		await expect(main.getByRole("button", { name: "Add expense" })).toHaveCount(
			0,
		);
		// The hero total is the server's: USD 90.00, never summed with anything else.
		await expect(main.getByText("USD 90.00").first()).toBeVisible();
		// The invite is gone from the address bar once it has been read.
		await expect(page).not.toHaveURL(/invite=/);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);

		await main.getByRole("link", { name: "Summary" }).click();
		await expect(
			main.getByRole("heading", { name: "Who paid what" }),
		).toBeVisible();
		await main.getByRole("link", { name: "People" }).click();
		await expect(main.getByText("Nico")).toBeVisible();
	});

	test("a link that never existed says so", async ({ page }) => {
		await gotoReady(page, `/projects/${ids.project}?invite=nope`);
		await expect(
			page.getByText("This invite does not work", { exact: true }),
		).toBeVisible();
	});
});

test.describe("an invite that makes a guest", () => {
	test.use({ storageState: NO_SESSION });

	test("joins with a name and an email, then adds an expense and takes it back", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, `/projects/${ids.project}?invite=${ids.guestLink}`);
		await expect(
			page.getByRole("heading", { name: `Join ${PROJECT}` }),
		).toBeVisible();
		await page.getByLabel("Your name").fill("Lucy Guest");
		await page.getByLabel("Email", { exact: true }).fill("lucy.guest@example.com");
		await page.getByRole("button", { name: "Join project" }).click();
		await expect(page.getByRole("heading", { name: "You are in" })).toBeVisible();
		await page.getByRole("button", { name: "View project" }).click();

		await openShared(page, `/projects/${ids.project}`);
		guestStorage = await page.evaluate(() => ({
			guest_session_token: localStorage.getItem("guest_session_token") ?? "",
			guest_project_id: localStorage.getItem("guest_project_id") ?? "",
		}));
		const main = page.getByRole("main");
		await expect(main.getByRole("status")).toContainText(
			"Viewing as Lucy Guest, guest",
		);
		await expect(main.getByText("Dinner")).toBeVisible();

		// A contributor adds an expense: the sheet says what it adds and Undo takes it back.
		await main.getByRole("button", { name: "Add expense" }).click();
		const sheet = page.getByRole("dialog", {
			name: `Add expense to ${PROJECT}`,
		});
		await sheet.getByLabel("What was it for").fill("E2E Taxi");
		await sheet.getByRole("textbox", { name: "Amount" }).fill("30");
		await expect(sheet).toContainText("split equally between 3 people");
		await sheet.getByRole("button", { name: "Add expense" }).click();
		await expect(sheet).toBeHidden();
		await expect(main.getByText("E2E Taxi")).toBeVisible();
		await page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Added E2E Taxi" })
			.getByRole("button", { name: "Undo" })
			.click();
		await expect(main.getByText("E2E Taxi")).toHaveCount(0);

		// Her own balance with the others, nothing to settle from here.
		await main.getByRole("link", { name: "Summary" }).click();
		await expect(main.getByText("You and each person")).toBeVisible();
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
	});

	test("on a phone: one column and nothing wider than the screen", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openShared(page, `/projects/${ids.project}?invite=${ids.viewerLink}`);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
		await expect(page.getByRole("main").getByText("Dinner")).toBeVisible();
	});
});

test.describe("the public page", () => {
	test.use({ storageState: NO_SESSION });

	test("is private until the owner makes it public", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, `/projects/${ids.project}`);
		await expect(page.getByText("This project is private")).toBeVisible();

		await trpc("project.update", { id: ids.project, visibility: "PUBLIC" });
		await openShared(page, `/projects/${ids.project}`);
		const main = page.getByRole("main");
		await expect(main.getByRole("status")).toContainText("Public view");
		await expect(main.getByText("Dinner")).toBeVisible();
		// No People tab and no balances on the public page.
		await expect(main.getByRole("link", { name: "People" })).toHaveCount(0);
		await main.getByRole("link", { name: "Summary" }).click();
		await expect(main.getByText("You and each person")).toHaveCount(0);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);

		await trpc("project.update", { id: ids.project, visibility: "PRIVATE" });
	});
});

test.describe("the owner", () => {
	test.use({ storageState: USER_STORAGE_STATE });

	test("still gets the full page with Add expense and the menu", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, `/projects/${ids.project}`);
		const main = page.getByRole("main");
		await expect(
			main.getByRole("heading", { name: PROJECT, level: 1 }),
		).toBeVisible();
		await expect(main.getByRole("button", { name: "Add expense" })).toBeVisible();
	});
});

// Screenshots of the three views in light and dark at 1440 and 390, written
// where E2E_SHOTS_DIR points (the owner's review folder). Off by default.
const SHOTS = process.env.E2E_SHOTS_DIR;

test.describe("screenshots", () => {
	test.skip(!SHOTS, "set E2E_SHOTS_DIR to write them");

	for (const view of ["guest", "viewer", "public"] as const) {
		for (const theme of THEMES) {
			for (const width of WIDTHS) {
				test(`${view} ${theme} ${width}`, async ({ browser }) => {
					test.setTimeout(120_000);
					if (view === "public")
						await trpc("project.update", {
							id: ids.project,
							visibility: "PUBLIC",
						});
					const context = await browser.newContext({
						...contextFor(width, theme),
						baseURL: E2E_BASE_URL,
						locale: "en-US",
					});
					try {
						const page = await context.newPage();
						await useTheme(page, theme);
						if (view === "guest")
							await page.addInitScript((tokens) => {
								for (const [k, v] of Object.entries(tokens))
									localStorage.setItem(k, v);
							}, guestStorage);
						const path =
							view === "viewer"
								? `/projects/${ids.project}?invite=${ids.viewerLink}`
								: `/projects/${ids.project}`;
						await openShared(page, path);
						await expect(
							page.getByRole("main").getByText("Dinner").first(),
						).toBeVisible();
						await page.screenshot({
							path: `${SHOTS}/${view}-${theme}-${width}.png`,
							fullPage: true,
						});
					} finally {
						await context.close();
						if (view === "public")
							await trpc("project.update", {
								id: ids.project,
								visibility: "PRIVATE",
							});
					}
				});
			}
		}
	}
});
