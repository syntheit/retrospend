import { expect, type Page, test } from "@playwright/test";
import { personaStorageState } from "../../constants";
import { SOFIA } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import {
	FigureAudit,
	type FigureFetcher,
	type FiguresResponse,
	httpFigureFetcher,
} from "../../helpers/figures";
import { gotoReady } from "../../helpers/navigation";
import { untilSaved } from "../../helpers/trpc";

// The redesigned Home (uiV2, today's /dashboard) on Sofía's seeded ledger:
// the glance (one hero, Owed to you and You owe as two rows), Needs you
// with Lucía's cash payment, Recent and the rail. Every figure matches the
// figures API and People shows the same owed figures. Confirm, then Undo.

test.use({ storageState: personaStorageState(SOFIA.username) });

type Money = { minor: number; currency: string };

async function trpcQuery<T>(
	page: Page,
	path: string,
	input?: unknown,
): Promise<T> {
	const q = encodeURIComponent(JSON.stringify({ json: input ?? null }));
	const res = await page.request.get(`/api/trpc/${path}?input=${q}`);
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

/**
 * Registry figures go to the figures API. Row amounts have no registry id
 * yet (GAPS), so Recent's are read back from expense.listV2 and Coming
 * up's from recurring.listView, the reads the rows come from.
 */
function homeFetcher(page: Page): FigureFetcher {
	const http = httpFigureFetcher(page.request);
	return async (ids, currencies): Promise<FiguresResponse> => {
		const rowIds = ids.filter(
			(id) => id.startsWith("entry.") || id.startsWith("recurring.amount:"),
		);
		const byId = new Map<string, Money>();
		if (rowIds.length) {
			const list = await trpcQuery<{
				items: { id: string; amount: Money; share?: Money }[];
			}>(page, "expense.listV2", { kinds: ["expense", "refund"], limit: 200 });
			for (const r of list.items) {
				byId.set(`entry.amount:${r.id}`, r.amount);
				if (r.share) byId.set(`entry.share:${r.id}`, r.share);
			}
			const view = await trpcQuery<{
				items: { id: string; amount: Money }[];
			}>(page, "recurring.listView");
			for (const r of view.items)
				byId.set(`recurring.amount:${r.id}`, r.amount);
		}
		const rest = ids.filter((id) => !rowIds.includes(id));
		const served = rest.length
			? await http(rest, currencies)
			: { figures: [], missing: [] };
		return {
			figures: [
				...served.figures,
				...rowIds.flatMap((id) => {
					const m = byId.get(id);
					return m
						? [
								{
									id,
									unit: "money" as const,
									minor: m.minor,
									currency: m.currency,
								},
							]
						: [];
				}),
			],
			missing: [
				...(served.missing ?? []),
				...rowIds.filter((id) => !byId.has(id)),
			],
		};
	};
}

async function openHome(page: Page): Promise<void> {
	await gotoReady(page, "/dashboard");
	await expect(page.locator('[data-ui="v2"][data-page="home"]')).toBeVisible();
	// Every part has loaded: no skeletons left.
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test("Home: glance, Needs you, Recent and the rail; confirm a payment and undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewportSize({ width: 1440, height: 900 });
	await openHome(page);
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: "Home", level: 1 }),
	).toBeVisible();
	await expect(main.getByText(/^Spent in /)).toBeVisible();
	// D1: two rows, never netted.
	for (const row of ["Owed to you", "You owe", "Net worth"])
		await expect(
			main.getByRole("link", { name: new RegExp(`^${row}`) }),
		).toBeVisible();
	await expect(main.getByRole("heading", { name: /^Recent/ })).toBeVisible();
	await expect(main.getByRole("link", { name: /See all/ })).toHaveAttribute(
		"href",
		"/activity",
	);
	await expect(
		main.getByRole("complementary", { name: "At a glance" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	const audit = new FigureAudit(homeFetcher(page));
	expect(await audit.checkPage(page, "home")).toEqual([]);
	// People shows the same Owed to you and You owe.
	await gotoReady(page, "/people");
	expect(await audit.checkPage(page, "people", "peoplePage")).toEqual([]);
	expect(audit.crossPage()).toEqual([]);

	// Needs you: confirm Lucía's cash payment, then Undo puts it back.
	await openHome(page);
	const needs = main.getByRole("region", { name: /^Needs you/ });
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
	await expect(item).toHaveCount(0);
	await untilSaved(page, "settlement.paymentUnconfirm", () =>
		toast.getByRole("button", { name: "Undo" }).click(),
	);
	await expect(item).toBeVisible();
	expect(errors).toEqual([]);
});

test("Home on a phone: one column, no rail, nothing wider than the screen", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await openHome(page);
	const main = page.getByRole("main");
	await expect(main.getByText(/^Spent in /)).toBeVisible();
	await expect(main.getByRole("region", { name: /^Needs you/ })).toBeVisible();
	await expect(
		main.getByRole("complementary", { name: "At a glance" }),
	).toBeHidden();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
