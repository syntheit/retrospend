/**
 * /api/v1 rate table and converter on Postgres: every currency priced in
 * the caller's home currency by the web page's own pricing, favorites first,
 * an open account's currency with no rate listed without a price (never 1),
 * and conversions rounded on the server.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	fixtureDb,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.currencies;
const day = (d: string) => new Date(`${d}T00:00:00Z`);

type Price = { minor: number; currency: string; places: number; base: string };
type Row = {
	code: string;
	crypto: boolean;
	rates: { type: string; price: Price | null; derived: boolean }[];
	defaultType: string | null;
	favorite: boolean;
	rateId: string | null;
	favoriteIds: string[];
	usedBy: string[];
};
type Table = {
	home: string;
	columns: string[];
	rows: Row[];
	updated: string | null;
	homeDefault: string | null;
	canSetDefault: boolean;
};
type Conversion = {
	from: { minor: number; currency: string };
	results: {
		type: string;
		value: { minor: number; currency: string };
		derived: boolean;
	}[];
};

describe("/api/v1 rate table and converter", () => {
	let as: Record<string, string>;
	let pygOfficial: string;

	beforeAll(async () => {
		// Rates are global and pg files share one database: BOB and PYG are
		// stored by no other pg test, and KGS by none at all.
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "BOB" },
		});
		as = await asMobile(user.id);
		await adminDb.exchangeRate.createMany({
			data: [
				{
					date: day("2025-04-01"),
					currency: "BOB",
					type: "official",
					rate: "6.91",
				},
				{ date: day("2025-04-01"), currency: "BOB", type: "blue", rate: "9.5" },
				{
					date: day("2025-04-01"),
					currency: "PYG",
					type: "official",
					rate: "7300",
				},
			],
		});
		pygOfficial = (
			await adminDb.exchangeRate.findFirstOrThrow({
				where: { currency: "PYG", type: "official" },
			})
		).id;
		await fixtureDb.assetAccount.createMany({
			data: [
				{
					userId: user.id,
					name: "Bishkek cash",
					type: "CASH",
					currency: "KGS",
					balance: 100,
				},
				{
					userId: user.id,
					name: "Old Dushanbe",
					type: "CASH",
					currency: "TJS",
					balance: 5,
					closedAt: new Date(),
				},
			],
		});
	});

	const table = async () =>
		expectBody<Table>(await call("/rates/table", { headers: as }), c.rateTable);

	it("prices each currency in the home currency, the stronger one as the unit", async () => {
		const t = await table();
		expect(t.home).toBe("BOB");
		expect(t.homeDefault).toBe("blue");
		expect(t.canSetDefault).toBe(false);
		expect(t.columns.slice(0, 2)).toEqual(["official", "blue"]);
		expect(t.rows.some((r) => r.code === "BOB")).toBe(false);

		const usd = t.rows.find((r) => r.code === "USD");
		expect(usd).toMatchObject({
			defaultType: "blue",
			favorite: false,
			rateId: null,
			rates: [
				{
					type: "official",
					price: { minor: 691, currency: "BOB", places: 2, base: "USD" },
					derived: false,
				},
				{
					type: "blue",
					price: { minor: 950, currency: "BOB", places: 2, base: "USD" },
					derived: false,
				},
			],
		});

		// 1 BOB buys 1,056 PYG. PYG has no blue, so Blue goes through its official
		// (derived); Blue comes before Official as the default.
		const pyg = t.rows.find((r) => r.code === "PYG");
		expect(pyg).toMatchObject({
			defaultType: "blue",
			rateId: pygOfficial,
			rates: [
				{
					type: "official",
					price: { minor: 1056, currency: "PYG", places: 0, base: "BOB" },
					derived: false,
				},
				{
					type: "blue",
					price: { minor: 768, currency: "PYG", places: 0, base: "BOB" },
					derived: true,
				},
			],
		});
	});

	it("lists an open account's currency with no rate, and no price", async () => {
		const t = await table();
		const kgs = t.rows.find((r) => r.code === "KGS");
		expect(kgs).toEqual({
			code: "KGS",
			crypto: false,
			rates: [],
			defaultType: null,
			favorite: false,
			rateId: null,
			favoriteIds: [],
			usedBy: ["Bishkek cash"],
		});
		// A closed account does not ask for a rate.
		expect(t.rows.some((r) => r.code === "TJS")).toBe(false);
	});

	it("puts a pinned currency first and lists the pins to remove", async () => {
		await expectBody(
			await call("/settings/favorite-rates", {
				method: "POST",
				headers: as,
				body: { exchangeRateId: pygOfficial },
				idempotent: true,
			}),
			contract.settings.addFavoriteRate,
		);
		const t = await table();
		expect(t.rows[0]).toMatchObject({
			code: "PYG",
			favorite: true,
			favoriteIds: [pygOfficial],
		});
	});

	it("converts at every rate type, both ways, on the server", async () => {
		const toHome = await expectBody<Conversion>(
			await call("/rates/PYG/convert?amount=100000&direction=toHome", {
				headers: as,
			}),
			c.convert,
		);
		expect(toHome).toEqual({
			from: { minor: 100000, currency: "PYG" },
			results: [
				{
					type: "official",
					value: { minor: 9466, currency: "BOB" },
					derived: false,
				},
				{
					type: "blue",
					value: { minor: 13014, currency: "BOB" },
					derived: true,
				},
			],
		});
		const fromHome = await expectBody<Conversion>(
			await call("/rates/PYG/convert?amount=1000&direction=fromHome", {
				headers: as,
			}),
			c.convert,
		);
		expect(fromHome.from).toEqual({ minor: 1000, currency: "BOB" });
		expect(fromHome.results.map((r) => [r.type, r.value.minor])).toEqual([
			["official", 10564],
			["blue", 7684],
		]);
	});

	it("gives no result without a rate, never a 1", async () => {
		for (const code of ["KGS", "BOB"]) {
			const none = await expectBody<Conversion>(
				await call(`/rates/${code}/convert?amount=500&direction=toHome`, {
					headers: as,
				}),
				c.convert,
			);
			expect(none.results).toEqual([]);
		}
	});

	it("checks the input and the scope", async () => {
		await expectProblem(
			await call("/rates/PYG/convert?amount=-1&direction=toHome", {
				headers: as,
			}),
			400,
			"validation_failed",
		);
		await expectProblem(
			await call("/rates/PYG/convert?amount=1&direction=sideways", {
				headers: as,
			}),
			400,
			"validation_failed",
		);
		await expectProblem(await call("/rates/table"), 401, "unauthenticated");
		const user = (await createTestUser()).user.id;
		await expectProblem(
			await call("/rates/table", {
				headers: await asKey(user, ["write:settings"]),
			}),
			403,
			"missing_scope",
		);
	});
});
