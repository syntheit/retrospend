/**
 * The small reads and writes that closed the last gaps, on Postgres: the Add
 * sheets' catalog and rate strip, the default rate type, Later on a Needs you
 * item, All time's first day, the lifetime totals, the AI status, the runway,
 * the frequent partners, the consent record and Move in. One ARS user with a
 * Savings account and a Wise account; a second user who sees none of it.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	arsUser,
	openAccount,
	seedArsRates,
	TODAY,
} from "~/server/services/accounts/test-fixtures";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Money = { minor: number; currency: string };

describe("gap-closing reads and small writes", () => {
	let userId: string;
	let otherId: string;
	let savings: string;
	let wise: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;
	// Its own address, so the shared per-IP limit never matters.
	const ip = { "x-forwarded-for": "198.51.100.91" };

	const send = (
		method: string,
		path: string,
		headers: Record<string, string>,
		body?: unknown,
		key?: string,
	) => call(path, { method, headers: { ...ip, ...headers }, body, idempotent: key ?? true });
	const get = (path: string, headers = as) =>
		call(path, { headers: { ...ip, ...headers } });

	beforeAll(async () => {
		await seedArsRates();
		userId = (await arsUser()).user.id;
		otherId = (await arsUser()).user.id;
		savings = await openAccount(userId, "Savings", "CASH", "ARS", 1000);
		wise = await openAccount(userId, "Wise", "INVESTMENT", "USD", 1840.55, {
			exchangeRateType: "official",
		});
		as = await asMobile(userId);
		asOther = await asMobile(otherId);
	});

	describe("entry", () => {
		it("reads categories, recents and places in one call, only yours", async () => {
			const catalog = await expectBody<{
				homeCurrency: string;
				categories: { kind: string }[];
				places: { id: string; balance: Money; inBudget: boolean }[];
			}>(await get("/entry/catalog"), contract.entry.catalog);
			expect(catalog.homeCurrency).toBe("ARS");
			expect(catalog.categories.some((c) => c.kind === "INCOME")).toBe(true);
			const wiseRow = catalog.places.find((p) => p.id === wise);
			expect(wiseRow?.balance).toEqual({ minor: 184_055, currency: "USD" });
			const others = await expectBody<{ places: { id: string }[] }>(
				await get("/entry/catalog", asOther),
				contract.entry.catalog,
			);
			expect(others.places).toEqual([]);
		});

		it("lists every rate type a pair offers, and books the amount at each", async () => {
			const day = TODAY.toISOString().slice(0, 10);
			const strip = await expectBody<{
				homeCurrency: string;
				options: { rateType: string; rate: { value: Money }; home: Money | null }[];
				missing: unknown;
			}>(
				await get(`/entry/rate-options?currency=USD&date=${day}&amount=10`),
				contract.entry.rateOptions,
			);
			expect(strip.missing).toBeNull();
			const blue = strip.options.find((o) => o.rateType === "blue");
			expect(blue?.rate.value).toEqual({ minor: 146_800, currency: "ARS" });
			expect(blue?.home).toEqual({ minor: 1_468_000, currency: "ARS" });
			// Your home currency offers none.
			const home = await expectBody<{ options: unknown[] }>(
				await get(`/entry/rate-options?currency=ARS&date=${day}`),
				contract.entry.rateOptions,
			);
			expect(home.options).toEqual([]);
			await expectProblem(
				await get("/entry/rate-options?currency=USD&date=not-a-day"),
				400,
				"validation_failed",
			);
		});

		it("saves the default rate type per home currency, and clears it", async () => {
			const set = await expectBody<{
				items: { homeCurrency: string; rateType: string }[];
			}>(
				await send("PUT", "/entry/default-rate-types/ARS", as, {
					rateType: "mep",
				}),
				contract.entry.setDefaultRateType,
			);
			expect(set.items).toEqual([{ homeCurrency: "ARS", rateType: "mep" }]);
			await expectProblem(
				await send("PUT", "/entry/default-rate-types/ARS", as, {
					rateType: "custom",
				}),
				400,
				"bad_request",
			);
			const cleared = await expectBody<{ items: unknown[] }>(
				await send("PUT", "/entry/default-rate-types/ARS", as, { rateType: null }),
				contract.entry.setDefaultRateType,
			);
			expect(cleared.items).toEqual([]);
			expect(
				(await expectBody<{ items: unknown[] }>(
					await get("/entry/default-rate-types", asOther),
					contract.entry.defaultRateTypes,
				)).items,
			).toEqual([]);
		});
	});

	describe("Needs you", () => {
		const itemId = "split.review:abc123";

		it("snoozes an item until tomorrow, replays, and brings it back", async () => {
			const key = randomUUID();
			const body = { id: randomUUID(), itemId };
			const snoozed = await expectBody<{ itemId: string; until: string }>(
				await send("POST", "/needs-you/snoozes", as, body, key),
				contract["needs-you"].snooze,
				201,
			);
			expect(snoozed.itemId).toBe(itemId);
			expect(new Date(snoozed.until).getTime()).toBeGreaterThan(Date.now());
			const replay = await send("POST", "/needs-you/snoozes", as, body, key);
			expect(replay.headers.get("idempotent-replayed")).toBe("true");
			expect(await adminDb.needsYouSnooze.count({ where: { userId } })).toBe(1);

			// Someone else's snooze list is their own.
			await send("DELETE", `/needs-you/snoozes/${encodeURIComponent(itemId)}`, asOther);
			expect(await adminDb.needsYouSnooze.count({ where: { userId } })).toBe(1);

			await expectBody(
				await send("DELETE", `/needs-you/snoozes/${encodeURIComponent(itemId)}`, as),
				contract["needs-you"].unsnooze,
			);
			expect(await adminDb.needsYouSnooze.count({ where: { userId } })).toBe(0);
			await expectProblem(
				await send("POST", "/needs-you/snoozes", as, { itemId: "nonsense" }),
				400,
				"validation_failed",
			);
		});
	});

	describe("reads", () => {
		it("gives the first day of spending, null with none", async () => {
			const none = await expectBody<{ day: string | null }>(
				await get("/figures/first-day"),
				contract.figures.firstDay,
			);
			expect(none.day).toBeNull();
			await expectBody(
				await send("POST", "/expenses", as, {
					title: "Coffee",
					amount: "500",
					currency: "ARS",
					date: "2026-03-04",
				}),
				contract.expenses.create,
				201,
			);
			const first = await expectBody<{ day: string | null }>(
				await get("/figures/first-day"),
				contract.figures.firstDay,
			);
			expect(first.day).toBe("2026-03-04");
		});

		it("gives the lifetime totals as Money in the home currency", async () => {
			const stats = await expectBody<{
				lifetimeSpend: Money;
				totalEntries: number;
				joinedAt: string;
			}>(await get("/profile/stats"), contract.profile.stats);
			expect(stats.lifetimeSpend).toEqual({ minor: 50_000, currency: "ARS" });
			expect(stats.totalEntries).toBe(1);
			expect(Number.isNaN(Date.parse(stats.joinedAt))).toBe(false);
		});

		it("says whether the AI features are available", async () => {
			const status = await expectBody<{
				currentMode: string;
				externalAvailable: boolean;
			}>(await get("/settings/ai-status"), contract.settings.aiStatus);
			expect(status.currentMode).toBe("LOCAL");
			expect(typeof status.externalAvailable).toBe("boolean");
		});

		it("gives the runway as the average monthly spend", async () => {
			const runway = await expectBody<{
				averageMonthlySpend: Money;
				monthsActive: number;
			}>(await get("/accounts/runway"), contract.accounts.runway);
			expect(runway.averageMonthlySpend.currency).toBe("ARS");
			expect(runway.monthsActive).toBeGreaterThanOrEqual(1);
			const usd = await expectBody<{ averageMonthlySpend: Money }>(
				await get("/accounts/runway?currency=ARS"),
				contract.accounts.runway,
			);
			expect(usd.averageMonthlySpend.currency).toBe("ARS");
		});

		it("lists the people you split with most, and no one else's", async () => {
			const other = await arsUser();
			const shared = await adminDb.sharedTransaction.create({
				data: {
					description: "Lunch",
					amount: "10",
					currency: "ARS",
					date: new Date("2026-10-01"),
					paidByType: "user",
					paidById: userId,
					createdByType: "user",
					createdById: userId,
					splitParticipants: {
						create: [
							{ participantType: "user", participantId: userId, shareAmount: "5", verificationStatus: "ACCEPTED" },
							{ participantType: "user", participantId: other.user.id, shareAmount: "5", verificationStatus: "ACCEPTED" },
						],
					},
				},
			});
			expect(shared.id).toBeTruthy();
			const frequent = await expectBody<{ items: { id: string; type: string }[] }>(
				await get("/people/frequent"),
				contract.people.frequent,
			);
			expect(frequent.items).toEqual([
				expect.objectContaining({ id: other.user.id, type: "user" }),
			]);
		});
	});

	describe("consent", () => {
		it("records the version and the address", async () => {
			await expectBody(
				await send("POST", "/me/consent", as, { consentVersion: "2026-10" }),
				contract.account.recordConsent,
			);
			const row = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
			expect(row.consentVersion).toBe("2026-10");
			expect(row.consentedAt).not.toBeNull();
			expect(row.consentIp).toBe("198.51.100.91");
			await expectProblem(
				await send("POST", "/me/consent", as, { consentVersion: "" }),
				400,
				"validation_failed",
			);
			await expectProblem(
				await send(
					"POST",
					"/me/consent",
					await asKey(userId, ["read", "write:expenses"]),
					{ consentVersion: "x" },
				),
				403,
				"missing_scope",
			);
		});
	});

	describe("Move in", () => {
		it("counts a kept income in the budget without moving an account, previews, undoes and redoes", async () => {
			const income = await expectBody<{ income: { id: string } }>(
				await send("POST", "/income", as, {
					title: "Estudio Norte",
					amount: "2000",
					currency: "USD",
					rateType: "mep",
					into: wise,
				}),
				contract.income.create,
				201,
			);
			const id = income.income.id;
			const counted = async () =>
				(await adminDb.assetAccount.findUniqueOrThrow({ where: { id: wise } }))
					.countedUnits.toString();
			const balance = async () =>
				(await adminDb.assetAccount.findUniqueOrThrow({ where: { id: wise } }))
					.balance.toString();
			const before = await balance();

			const preview = await send("POST", "/income/move-in/preview", as, {
				expenseId: id,
			});
			expect(preview.status).toBe(200);
			expect(await counted()).toBe("0");

			const key = randomUUID();
			const moved = await expectBody<{
				moved: { accountId: string; expenseId: string; amount: Money; countedUnits: string };
				undo: string;
			}>(
				await send("POST", "/income/move-in", as, { expenseId: id }, key),
				contract.income.moveIn,
				201,
			);
			// Booked at MEP (2,898,000), not today's official value.
			expect(moved.moved).toMatchObject({
				accountId: wise,
				expenseId: id,
				amount: { minor: 289_800_000, currency: "ARS" },
				countedUnits: "2000",
			});
			// No account moved: the dollars stay in Wise.
			expect(await balance()).toBe(before);
			expect(await counted()).toBe("2000");
			const replay = await send("POST", "/income/move-in", as, { expenseId: id }, key);
			expect(replay.headers.get("idempotent-replayed")).toBe("true");
			// Once is enough.
			await expectProblem(
				await send("POST", "/income/move-in", as, { expenseId: id }),
				400,
				"bad_request",
			);

			const undone = await expectBody<{ id: string; redo: string }>(
				await send("POST", "/income/undo", as, { token: moved.undo }),
				contract.income.undo,
			);
			expect(undone.id).toBe(id);
			expect(await counted()).toBe("0");
			const redone = await expectBody<{ redo: string }>(
				await send("POST", "/income/undo", as, { token: undone.redo }),
				contract.income.undo,
			);
			expect(await counted()).toBe("2000");
			expect(redone.redo).toBeTruthy();
		});

		it("counts units of an account by a client id, and refuses what is not yours", async () => {
			const move = {
				id: randomUUID(),
				accountId: wise,
				units: "100",
			};
			const before = Number(
				(await adminDb.assetAccount.findUniqueOrThrow({ where: { id: wise } }))
					.countedUnits,
			);
			await expectBody(
				await send("POST", "/income/move-in", as, move),
				contract.income.moveIn,
				201,
			);
			expect(
				Number(
					(await adminDb.assetAccount.findUniqueOrThrow({ where: { id: wise } }))
						.countedUnits,
				),
			).toBe(before + 100);
			await expectProblem(
				await send("POST", "/income/move-in", asOther, {
					id: randomUUID(),
					accountId: wise,
					units: "1",
				}),
				404,
				"not_found",
			);
			await expectProblem(
				await send("POST", "/income/move-in", as, { ...move, id: randomUUID(), units: "999999" }),
				400,
				"bad_request",
			);
			expect(savings).toBeTruthy();
		});
	});
});
