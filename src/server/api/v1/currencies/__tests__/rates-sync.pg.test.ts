/**
 * /api/v1 rate sync for devices on Postgres: GET /rates/daily is the whole
 * exchange_rate table in one body with an ETag, GET /rates/history pages the
 * raw daily history. The device's pick from the daily rows must equal the
 * server's pick from the table (findExchangeRatesForDates, what figures use).
 * TZS and GHS are stored by no other pg test; the history sits in 2019.
 */
import { contract } from "@retrospend/api-contract";
import {
	pickBestRate,
	rateLookup,
	rateRowsByCurrency,
} from "@retrospend/domain/money";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findExchangeRatesForDates } from "~/server/exchange-rates";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.currencies;
const at = (iso: string) => new Date(iso);

type Daily = {
	asOf: string | null;
	rates: {
		id: string;
		currency: string;
		type: string;
		date: string;
		unitsPerUsd: string;
		updatedAt: string;
	}[];
};
type Day = {
	date: string;
	currency: string;
	type: string;
	unitsPerUsd: string;
};

describe("/api/v1 rate sync", () => {
	let as: Record<string, string>;
	const daily = async () =>
		expectBody<Daily>(
			await call("/rates/daily", { headers: as }),
			c.dailyRates,
		);
	const mine = (d: Daily) =>
		d.rates.filter((r) => r.currency === "TZS" || r.currency === "GHS");

	beforeAll(async () => {
		as = await asMobile((await createTestUser()).user.id);
		await adminDb.exchangeRate.createMany({
			data: [
				{
					date: at("2019-06-01T00:00:00Z"),
					currency: "TZS",
					type: "official",
					rate: "2300.5",
				},
				{
					date: at("2019-06-08T00:00:00Z"),
					currency: "TZS",
					type: "official",
					rate: "2310",
				},
				{
					date: at("2019-06-12T00:00:00Z"),
					currency: "TZS",
					type: "blue",
					rate: "2400",
				},
				{
					date: at("2019-06-01T00:00:00Z"),
					currency: "GHS",
					type: "official",
					rate: "5.5",
				},
			],
		});
		await adminDb.exchangeRateHistory.createMany({
			data: [
				{
					date: at("2019-01-03"),
					currency: "TZS",
					type: "official",
					rate: "2200",
				},
				{
					date: at("2019-01-01"),
					currency: "GHS",
					type: "official",
					rate: "4.9",
				},
				{
					date: at("2019-01-01"),
					currency: "TZS",
					type: "official",
					rate: "2190.25",
				},
				{ date: at("2019-01-01"), currency: "TZS", type: "blue", rate: "2250" },
				{
					date: at("2019-01-02"),
					currency: "GHS",
					type: "official",
					rate: "4.95",
				},
			],
		});
	});

	afterAll(async () => {
		await adminDb.exchangeRate.deleteMany({
			where: { currency: { in: ["TZS", "GHS"] } },
		});
		await adminDb.exchangeRateHistory.deleteMany({
			where: { currency: { in: ["TZS", "GHS"] } },
		});
	});

	describe("GET /rates/daily", () => {
		it("returns every row exactly as stored, ordered, with no USD and no derived row", async () => {
			const body = await daily();
			expect(
				mine(body).map((r) => [r.currency, r.type, r.date, r.unitsPerUsd]),
			).toEqual([
				["GHS", "official", "2019-06-01T00:00:00.000Z", "5.5"],
				["TZS", "blue", "2019-06-12T00:00:00.000Z", "2400"],
				["TZS", "official", "2019-06-01T00:00:00.000Z", "2300.5"],
				["TZS", "official", "2019-06-08T00:00:00.000Z", "2310"],
			]);
			expect(body.rates.every((r) => Number(r.unitsPerUsd) > 0)).toBe(true);
			const newest = Math.max(
				...body.rates.map((r) => Date.parse(r.updatedAt)),
			);
			expect(body.asOf).toBe(new Date(newest).toISOString());
		});

		it("never has a USD row, even when one is stored", async () => {
			await adminDb.exchangeRate.create({
				data: {
					date: at("2019-06-01T00:00:00Z"),
					currency: "USD",
					type: "official",
					rate: "1",
				},
			});
			try {
				expect((await daily()).rates.some((r) => r.currency === "USD")).toBe(
					false,
				);
			} finally {
				await adminDb.exchangeRate.deleteMany({ where: { currency: "USD" } });
			}
		});

		it("leaves a currency with no row absent, never a row at 1", async () => {
			const body = await daily();
			expect(body.rates.some((r) => r.currency === "KZT")).toBe(false);
			const server = await findExchangeRatesForDates(adminDb, ["KZT"]);
			expect(server("KZT", at("2019-06-10T12:00:00Z"))).toBeNull();
			const device = rateLookup(
				rateRowsByCurrency(
					body.rates.map((r) => ({
						...r,
						rate: r.unitsPerUsd,
						date: at(r.date),
					})),
					["KZT"],
				),
			);
			expect(device("KZT", at("2019-06-10T12:00:00Z"))).toBeNull();
		});

		it("gives a device the pick the server's figures make, on the same rows", async () => {
			const body = await daily();
			const device = rateLookup(
				rateRowsByCurrency(
					body.rates.map((r) => ({
						...r,
						rate: r.unitsPerUsd,
						date: at(r.date),
					})),
					["TZS", "GHS"],
				),
			);
			const server = await findExchangeRatesForDates(adminDb, ["TZS", "GHS"]);
			// By hand. On 2019-06-10 official has 2310 (the 8th) on or before and
			// blue has only 2400 (the 12th) after, so official 2310 ranks first;
			// asking for blue takes blue as it is. On the 13th blue is on or
			// before and ranks first. Before every row, blue still ranks first.
			const cases: [string, string, string | undefined, string, number][] = [
				["TZS", "2019-06-10T12:00:00Z", undefined, "official", 2310],
				["TZS", "2019-06-10T12:00:00Z", "blue", "blue", 2400],
				["TZS", "2019-06-10T12:00:00Z", "official", "official", 2310],
				["TZS", "2019-06-13T12:00:00Z", undefined, "blue", 2400],
				["TZS", "2019-06-05T12:00:00Z", undefined, "official", 2300.5],
				["TZS", "2019-05-01T00:00:00Z", undefined, "blue", 2400],
				["GHS", "2019-06-10T12:00:00Z", undefined, "official", 5.5],
			];
			for (const [code, when, preferred, type, rate] of cases) {
				const expected = { type, rate };
				expect(
					device(code, at(when), preferred),
					`${code} ${when}`,
				).toMatchObject(expected);
				expect(
					server(code, at(when), preferred),
					`${code} ${when}`,
				).toMatchObject(expected);
				expect(device(code, at(when), preferred)).toEqual(
					server(code, at(when), preferred),
				);
			}
			// And the pick over the rows alone, as pickBestRate sees them.
			expect(
				pickBestRate(
					[
						{ type: "official", rate: 2300.5, date: at("2019-06-01") },
						{ type: "official", rate: 2310, date: at("2019-06-08") },
					],
					{ date: at("2019-06-10T12:00:00Z") },
				),
			).toMatchObject({ type: "official", rate: 2310 });
		});

		it("answers 304 with no body to its own ETag, and 200 once any row is rewritten", async () => {
			const first = await call("/rates/daily", { headers: as });
			const etag = first.headers.get("etag");
			expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
			await first.text();

			const again = await call("/rates/daily", { headers: as });
			expect(again.headers.get("etag")).toBe(etag);
			await again.text();

			for (const sent of [etag as string, `W/${etag}`, `"x", ${etag}`, "*"]) {
				const res = await call("/rates/daily", {
					headers: { ...as, "if-none-match": sent },
				});
				expect(res.status, sent).toBe(304);
				expect(res.headers.get("etag")).toBe(etag);
				expect(await res.text()).toBe("");
			}
			const stale = await call("/rates/daily", {
				headers: { ...as, "if-none-match": '"other"' },
			});
			expect(stale.status).toBe(200);
			await stale.text();

			// The sidecar rewrites a row in place: the body, asOf and tag all move.
			await adminDb.exchangeRate.updateMany({
				where: { currency: "GHS", type: "official" },
				data: { rate: "5.75", updatedAt: new Date(Date.now() + 60_000) },
			});
			const after = await call("/rates/daily", {
				headers: { ...as, "if-none-match": etag as string },
			});
			expect(after.status).toBe(200);
			expect(after.headers.get("etag")).not.toBe(etag);
			const body = (await after.json()) as Daily;
			expect(mine(body).find((r) => r.currency === "GHS")?.unitsPerUsd).toBe(
				"5.75",
			);
		});

		it("shows the whole old table while a rewrite is open and the whole new one after it commits", async () => {
			const old = await daily();
			const rewrite = async (tx: typeof adminDb) => {
				// Two rows in place, as the sidecar rewrites them in one transaction.
				await tx.exchangeRate.updateMany({
					where: { currency: "GHS", type: "official" },
					data: { rate: "6.25", updatedAt: new Date("2030-01-01T00:00:00Z") },
				});
				await tx.exchangeRate.updateMany({
					where: { currency: "TZS", type: "blue" },
					data: { rate: "2500", updatedAt: new Date("2030-01-01T00:00:00Z") },
				});
			};
			let release: () => void = () => undefined;
			const gate = new Promise<void>((r) => {
				release = r;
			});
			let opened: () => void = () => undefined;
			const open = new Promise<void>((r) => {
				opened = r;
			});
			const holding = adminDb.$transaction(async (tx) => {
				await rewrite(tx as typeof adminDb);
				opened();
				await gate;
			});
			try {
				await open;
				// Neither row of the open rewrite shows: not one new value beside an old one.
				expect(await daily()).toEqual(old);
			} finally {
				release();
				await holding;
			}
			const after = await daily();
			expect(after.asOf).toBe("2030-01-01T00:00:00.000Z");
			const value = (code: string, type: string) =>
				after.rates.find((r) => r.currency === code && r.type === type)
					?.unitsPerUsd;
			expect(value("GHS", "official")).toBe("6.25");
			expect(value("TZS", "blue")).toBe("2500");
			// Every row it did not rewrite is as it was.
			const untouched = (d: Daily) =>
				d.rates.filter(
					(r) =>
						!(r.type === "blue" && r.currency === "TZS") &&
						!(r.currency === "GHS" && r.type === "official"),
				);
			expect(untouched(after)).toEqual(untouched(old));
		});

		it("needs the read scope", async () => {
			const user = (await createTestUser()).user.id;
			const reader = await asKey(user, ["read"]);
			expect((await call("/rates/daily", { headers: reader })).status).toBe(
				200,
			);
			await expectProblem(
				await call("/rates/daily", {
					headers: await asKey(user, ["write:expenses"]),
				}),
				403,
				"missing_scope",
			);
			await expectProblem(await call("/rates/daily"), 401, "unauthenticated");
		});
	});

	describe("GET /rates/history", () => {
		const page = async (query: string) =>
			expectBody<{ items: Day[]; nextCursor: string | null }>(
				await call(`/rates/history?${query}`, { headers: as }),
				c.historyRates,
			);
		const label = (r: Day) =>
			`${r.date} ${r.currency} ${r.type} ${r.unitsPerUsd}`;
		const JAN = "from=2019-01-01&to=2019-01-31";

		it("pages every currency by (date, currency, type), each row once", async () => {
			const first = await page(`${JAN}&limit=2`);
			expect(first.items.map(label)).toEqual([
				"2019-01-01 GHS official 4.9",
				"2019-01-01 TZS blue 2250",
			]);
			const second = await page(`${JAN}&limit=2&cursor=${first.nextCursor}`);
			expect(second.items.map(label)).toEqual([
				"2019-01-01 TZS official 2190.25",
				"2019-01-02 GHS official 4.95",
			]);
			const third = await page(`${JAN}&limit=2&cursor=${second.nextCursor}`);
			expect(third.items.map(label)).toEqual(["2019-01-03 TZS official 2200"]);
			expect(third.nextCursor).toBeNull();
		});

		it("keeps to the range, inclusive", async () => {
			const day2 = await page("from=2019-01-02&to=2019-01-02");
			expect(day2.items.map(label)).toEqual(["2019-01-02 GHS official 4.95"]);
			expect((await page("from=2019-02-01&to=2019-02-28")).items).toEqual([]);
		});

		it("serves a 366 day range, both ends counted, and refuses a longer one", async () => {
			expect(
				(
					await call("/rates/history?from=2019-01-01&to=2020-01-01", {
						headers: as,
					})
				).status,
			).toBe(200);
			await expectProblem(
				await call("/rates/history?from=2019-01-01&to=2020-01-02", {
					headers: as,
				}),
				400,
				"validation_failed",
			);
			await expectProblem(
				await call("/rates/history?from=2019-01-02&to=2019-01-01", {
					headers: as,
				}),
				400,
				"validation_failed",
			);
			await expectProblem(
				await call("/rates/history?from=2019-01-01", { headers: as }),
				400,
				"validation_failed",
			);
			await expectProblem(
				await call(`/rates/history?${JAN}&limit=2001`, { headers: as }),
				400,
				"validation_failed",
			);
		});

		it("refuses a cursor that is not its own", async () => {
			await expectProblem(
				await call(`/rates/history?${JAN}&cursor=garbage`, { headers: as }),
				400,
				"bad_request",
			);
		});
	});
});
