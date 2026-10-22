/**
 * /api/v1/settings on Postgres: general settings with money as minor
 * units, page settings that keep to their page, category preferences and
 * pinned rates, idempotent replays, and RLS between users.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const s = contract.settings;

describe("/api/v1/settings", () => {
	useApiV1();
	let alice: string;
	let bob: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);
	});

	describe("general", () => {
		it("reads the defaults", async () => {
			const got = await expectBody(
				await call("/settings", { headers: asAlice }),
				s.get,
			);
			expect(got).toMatchObject({
				homeCurrency: "USD",
				monthlyIncome: null,
				fiscalMonthStartDay: 1,
				language: "en",
			});
		});

		it("stores monthly income from minor units and reads it back", async () => {
			// ARS 1.234.567,89 = 123456789 minor units.
			const patched = await expectBody(
				await call("/settings", {
					method: "PATCH",
					headers: asAlice,
					body: {
						homeCurrency: "ARS",
						monthlyIncome: { minor: 123_456_789, currency: "ARS" },
						fiscalMonthStartDay: 5,
					},
					idempotent: true,
				}),
				s.update,
			);
			expect(patched).toMatchObject({
				homeCurrency: "ARS",
				monthlyIncome: { minor: 123_456_789, currency: "ARS" },
				fiscalMonthStartDay: 5,
			});
			const row = await adminDb.user.findUniqueOrThrow({
				where: { id: alice },
			});
			expect(row.monthlyIncome?.toString()).toBe("1234567.89");
			expect(row.monthlyIncomeCurrency).toBe("ARS");
		});

		it("refuses income more precise than the column keeps", async () => {
			// 0.12345678 BTC needs 8 decimals; monthlyIncome keeps 2.
			await expectProblem(
				await call("/settings", {
					method: "PATCH",
					headers: asAlice,
					body: { monthlyIncome: { minor: 12_345_678, currency: "BTC" } },
					idempotent: true,
				}),
				400,
				"bad_request",
			);
			await expectProblem(
				await call("/settings", {
					method: "PATCH",
					headers: asAlice,
					body: {},
					idempotent: true,
				}),
				400,
				"validation_failed",
			);
		});

		it("changes only the caller (RLS)", async () => {
			await call("/settings", {
				method: "PATCH",
				headers: asBob,
				body: { language: "es-AR" },
				idempotent: true,
			});
			const alices = await expectBody(
				await call("/settings", { headers: asAlice }),
				s.get,
			);
			expect(alices).toMatchObject({ language: "en" });
		});
	});

	describe("page settings", () => {
		it("fills defaults, merges a patch and refuses another page's field", async () => {
			const table = await expectBody(
				await call("/settings/pages/table", { headers: asAlice }),
				s.getPage,
			);
			expect(table).toMatchObject({
				page: "table",
				settings: { version: 1, showDescriptions: true },
			});
			const patched = await expectBody(
				await call("/settings/pages/table", {
					method: "PATCH",
					headers: asAlice,
					body: { settings: { pageSize: 25 } },
					idempotent: true,
				}),
				s.updatePage,
			);
			expect(patched).toMatchObject({
				settings: { pageSize: 25, showDescriptions: true },
			});
			await expectProblem(
				await call("/settings/pages/table", {
					method: "PATCH",
					headers: asAlice,
					body: { settings: { showHistoryChart: false } },
					idempotent: true,
				}),
				400,
				"bad_request",
			);
			// Bob still has the default page size (RLS).
			const bobs = await expectBody<{ settings: { pageSize?: number } }>(
				await call("/settings/pages/table", { headers: asBob }),
				s.getPage,
			);
			expect(bobs.settings.pageSize).not.toBe(25);
		});
	});

	describe("category preferences", () => {
		it("seeds, sets and deletes, only for the caller's categories", async () => {
			const mine = await adminDb.category.create({
				data: { name: "Groceries", color: "emerald", userId: alice },
			});
			const theirs = await adminDb.category.create({
				data: { name: "Rent", color: "blue", userId: bob },
			});
			const listed = await expectBody<{ items: { categoryId: string }[] }>(
				await call("/settings/category-preferences", { headers: asAlice }),
				s.listCategoryPreferences,
			);
			expect(listed.items.map((p) => p.categoryId)).toContain(mine.id);
			expect(listed.items.map((p) => p.categoryId)).not.toContain(theirs.id);

			const set = await expectBody(
				await call(`/settings/category-preferences/${mine.id}`, {
					method: "PUT",
					headers: asAlice,
					body: { isFlexible: false },
					idempotent: true,
				}),
				s.setCategoryPreference,
			);
			expect(set).toEqual({
				categoryId: mine.id,
				categoryName: "Groceries",
				isFlexible: false,
			});
			await expectProblem(
				await call(`/settings/category-preferences/${theirs.id}`, {
					method: "PUT",
					headers: asAlice,
					body: { isFlexible: true },
					idempotent: true,
				}),
				404,
				"not_found",
			);
			await expectBody(
				await call(`/settings/category-preferences/${mine.id}`, {
					method: "DELETE",
					headers: asAlice,
					idempotent: true,
				}),
				s.deleteCategoryPreference,
			);
			await expect(
				adminDb.analyticsCategoryPreference.count({
					where: { userId: alice, categoryId: mine.id },
				}),
			).resolves.toBe(0);
		});
	});

	describe("favorite rates", () => {
		let rates: { id: string }[];

		beforeAll(async () => {
			const date = new Date("2026-10-20T00:00:00Z");
			rates = await Promise.all(
				["EUR", "ARS", "BRL"].map((currency) =>
					adminDb.exchangeRate.create({
						data: { date, currency, type: "official", rate: "1.5" },
					}),
				),
			);
		});

		const pin = (headers: Record<string, string>, id: string, key?: string) =>
			call("/settings/favorite-rates", {
				method: "POST",
				headers,
				body: { exchangeRateId: id },
				idempotent: key ?? true,
			});

		it("pins in order, reorders, unpins and replays once", async () => {
			const [eur, ars, brl] = rates.map((r) => r.id) as [
				string,
				string,
				string,
			];
			const key = randomUUID();
			const first = await expectBody(
				await pin(asAlice, eur, key),
				s.addFavoriteRate,
			);
			const again = await pin(asAlice, eur, key);
			expect(again.headers.get("idempotent-replayed")).toBe("true");
			expect(await again.json()).toEqual(first);
			await pin(asAlice, ars);
			await pin(asAlice, brl);
			await expect(
				adminDb.exchangeRateFavorite.count({ where: { userId: alice } }),
			).resolves.toBe(3);

			await expectBody(
				await call("/settings/favorite-rates/order", {
					method: "PUT",
					headers: asAlice,
					body: { exchangeRateIds: [brl, eur] },
					idempotent: true,
				}),
				s.reorderFavoriteRates,
			);
			const page1 = await expectBody<{
				items: { exchangeRateId: string; rate: { unitsPerUsd: string } }[];
				nextCursor: string | null;
			}>(
				await call("/settings/favorite-rates?limit=2", { headers: asAlice }),
				s.listFavoriteRates,
			);
			expect(page1.items.map((f) => f.exchangeRateId)).toEqual([brl, eur]);
			expect(page1.items[0]?.rate.unitsPerUsd).toBe("1.5");
			const page2 = await expectBody<{ items: { exchangeRateId: string }[] }>(
				await call(
					`/settings/favorite-rates?limit=2&cursor=${page1.nextCursor}`,
					{
						headers: asAlice,
					},
				),
				s.listFavoriteRates,
			);
			// Left out of the reorder, ARS goes after the listed pins.
			expect(page2.items.map((f) => f.exchangeRateId)).toEqual([ars]);

			await expectBody(
				await call(`/settings/favorite-rates/${eur}`, {
					method: "DELETE",
					headers: asAlice,
					idempotent: true,
				}),
				s.removeFavoriteRate,
			);
			const bobs = await expectBody<{ items: unknown[] }>(
				await call("/settings/favorite-rates", { headers: asBob }),
				s.listFavoriteRates,
			);
			expect(bobs.items).toEqual([]);
		});

		it("answers not_found for an unknown rate", async () => {
			await expectProblem(await pin(asAlice, "nope"), 404, "not_found");
		});
	});
});
