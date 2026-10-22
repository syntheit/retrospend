/**
 * /api/v1 currencies and rates on Postgres: exact decimal rates, the
 * newest rate per currency and type on a day, history pages, the best-rate
 * selection, sync status and the admin-only sync with one worker call per
 * Idempotency-Key.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IntegrationService } from "~/server/services/integration.service";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.currencies;
const day = (d: string) => new Date(`${d}T00:00:00Z`);
type Rate = {
	currency: string;
	type: string;
	date: string;
	unitsPerUsd: string;
};

describe("/api/v1 currencies and rates", () => {
	useApiV1();
	let as: Record<string, string>;

	beforeAll(async () => {
		as = await asMobile((await createTestUser()).user.id);
		// ARS has two rate types; the 18th is newer than the 15th.
		await adminDb.exchangeRate.createMany({
			data: [
				{
					date: day("2025-03-15"),
					currency: "ARS",
					type: "official",
					rate: "1050.25",
				},
				{
					date: day("2025-03-18"),
					currency: "ARS",
					type: "official",
					rate: "1061.5",
				},
				{
					date: day("2025-03-18"),
					currency: "ARS",
					type: "blue",
					rate: "1225",
				},
				{
					date: day("2025-03-17"),
					currency: "BTC",
					type: "crypto",
					rate: "0.000011",
				},
			],
		});
	});

	it("lists currencies with their stored rate types", async () => {
		const page = await expectBody<{
			items: {
				code: string;
				decimals: number;
				kind: string;
				rateTypes: string[];
			}[];
			nextCursor: string | null;
		}>(await call("/currencies?limit=200", { headers: as }), c.list);
		const ars = page.items.find((x) => x.code === "ARS");
		expect(ars).toMatchObject({
			decimals: 2,
			kind: "fiat",
			rateTypes: ["blue", "official"],
		});
		const crypto = await expectBody<{
			items: { code: string; decimals: number }[];
		}>(
			await call("/currencies?kind=crypto&limit=200", { headers: as }),
			c.list,
		);
		expect(crypto.items.find((x) => x.code === "BTC")?.decimals).toBe(8);
	});

	it("gives the newest rate per type on a day, exactly", async () => {
		const onThe16th = await expectBody<{ items: Rate[] }>(
			await call("/rates?currency=ARS&date=2025-03-16", { headers: as }),
			c.listRates,
		);
		expect(onThe16th.items).toEqual([
			expect.objectContaining({
				type: "official",
				date: "2025-03-15",
				unitsPerUsd: "1050.25",
			}),
		]);
		const latest = await expectBody<{ items: Rate[] }>(
			await call("/rates?currency=ARS", { headers: as }),
			c.listRates,
		);
		expect(latest.items.map((r) => [r.type, r.unitsPerUsd])).toEqual([
			["blue", "1225"],
			["official", "1061.5"],
		]);
		const btc = await expectBody<{ items: Rate[] }>(
			await call("/rates?currency=BTC", { headers: as }),
			c.listRates,
		);
		expect(btc.items[0]?.unitsPerUsd).toBe("0.000011");
	});

	it("pages history newest first", async () => {
		const first = await expectBody<{
			items: Rate[];
			nextCursor: string | null;
		}>(
			await call("/rates/ARS/history?limit=2", { headers: as }),
			c.rateHistory,
		);
		expect(first.items.map((r) => `${r.date} ${r.type}`)).toEqual([
			"2025-03-18 blue",
			"2025-03-18 official",
		]);
		const second = await expectBody<{
			items: Rate[];
			nextCursor: string | null;
		}>(
			await call(`/rates/ARS/history?limit=2&cursor=${first.nextCursor}`, {
				headers: as,
			}),
			c.rateHistory,
		);
		expect(second.items.map((r) => r.date)).toEqual(["2025-03-15"]);
		expect(second.nextCursor).toBeNull();
	});

	it("picks the best rate like an expense save does", async () => {
		const best = await expectBody(
			await call("/rates/ARS/best?date=2025-03-18", { headers: as }),
			c.bestRate,
		);
		// Blue wins when nothing is preferred.
		expect(best).toMatchObject({
			type: "blue",
			unitsPerUsd: "1225",
			onOrBefore: true,
		});
		const official = await expectBody(
			await call("/rates/ARS/best?date=2025-03-18&type=official", {
				headers: as,
			}),
			c.bestRate,
		);
		expect(official).toMatchObject({ type: "official", unitsPerUsd: "1061.5" });
		const usd = await expectBody(
			await call("/rates/USD/best", { headers: as }),
			c.bestRate,
		);
		expect(usd).toMatchObject({ unitsPerUsd: "1", exchangeRateId: null });
		await expectProblem(
			await call("/rates/XAG/best", { headers: as }),
			404,
			"not_found",
		);
	});

	it("reports sync status", async () => {
		const status = await expectBody<{ latestRateDate: string | null }>(
			await call("/rates/sync-status", { headers: as }),
			c.syncStatus,
		);
		expect(status.latestRateDate).not.toBeNull();
	});

	it("lets only an admin start a sync, once per key", async () => {
		const worker = vi
			.spyOn(IntegrationService, "requestWorker")
			.mockResolvedValue(new Response(null, { status: 202 }));
		try {
			const user = await webCookieFor((await createTestUser()).user.id);
			await expectProblem(
				await call("/rates/sync", {
					method: "POST",
					headers: user,
					idempotent: true,
				}),
				403,
				"missing_scope",
			);
			const admin = await webCookieFor(
				(await createTestUser({ role: "ADMIN" })).user.id,
			);
			const key = randomUUID();
			const first = await call("/rates/sync", {
				method: "POST",
				headers: admin,
				idempotent: key,
			});
			await expectBody(first, c.sync, 202);
			const replay = await call("/rates/sync", {
				method: "POST",
				headers: admin,
				idempotent: key,
			});
			expect(replay.status).toBe(202);
			expect(replay.headers.get("idempotent-replayed")).toBe("true");
			expect(worker).toHaveBeenCalledTimes(1);
		} finally {
			worker.mockRestore();
		}
	});
});
