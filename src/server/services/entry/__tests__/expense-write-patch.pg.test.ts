/**
 * Characterization of today's expense patch rules (slice-device-writes PR0):
 * what a create or an update stores when fields are left out, how the rate
 * is kept or booked again, the excludeFromAnalytics order against a
 * category's default, and the day read in the user's zone. Each rule runs on
 * web tRPC `entry.expense.*`, the legacy `expense.*` router and v1 /expenses
 * (PUT replaces the whole row). ARS home: USD 100 at Official 1,412 books
 * ARS 141,200; at Blue 1,468, ARS 146,800.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asMobile, fixtureDb } from "~/server/api/v1/core/__tests__/harness";
import {
	arsUser,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { adminDb } from "~/test/pg-harness";
import {
	book,
	DAY,
	expectUnchanged,
	type Fields,
	feeRow,
	lunch,
	MISSING_RATE,
	makeWorld,
	NAMES,
	spreadRow,
	stored,
	transportsOf,
	type World,
} from "./expense-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

let w: World;
beforeAll(async () => {
	w = await makeWorld();
});

const NO_OPTIONALS = (f: Fields): Fields => ({
	title: f.title,
	amount: f.amount,
	currency: f.currency,
	date: f.date,
	categoryId: f.categoryId,
});

describe("an update replaces the row", () => {
	it.each(NAMES)(
		"%s: clears a location and a description that are left out, and keeps excludeFromAnalytics",
		async (name) => {
			const id = await book(
				w.userId,
				lunch(w, {
					location: "Cafe",
					description: "Menu",
					excludeFromAnalytics: true,
				}),
			);
			expect(
				await w[name].update(id, NO_OPTIONALS(lunch(w, { title: "Bare" }))),
			).toEqual({ ok: true });
			expect(await stored(id)).toMatchObject({
				title: "Bare",
				location: null,
				description: null,
				categoryId: w.food,
				excludeFromAnalytics: true,
			});
		},
	);

	// The web's form always names a category, so only v1 and the legacy router can leave it out.
	it.each(["v1", "legacy"] as const)(
		"%s: clears the category when it is left out",
		async (name) => {
			const id = await book(w.userId, lunch(w));
			expect(
				await w[name].update(id, {
					...NO_OPTIONALS(lunch(w)),
					categoryId: undefined,
				}),
			).toEqual({ ok: true });
			expect((await stored(id))?.categoryId).toBeNull();
		},
	);

	it.each(NAMES)(
		"%s: takes the spread parts away when amortizeOver is left out, and re-spreads when it is sent",
		async (name) => {
			const { id, parts } = await spreadRow(w);
			expect(parts).toHaveLength(3);
			expect(
				await w[name].update(id, lunch(w, { amount: "120", amortizeOver: 4 })),
			).toEqual({ ok: true });
			expect((await stored(id))?.children).toHaveLength(4);
			expect(await w[name].update(id, lunch(w, { amount: "120" }))).toEqual({
				ok: true,
			});
			expect(await stored(id)).toMatchObject({
				isAmortizedParent: false,
				children: [],
			});
		},
	);

	// The legacy router takes no cuid ids, and a fee row's id is one.
	it.each(["entry", "v1"] as const)(
		"%s: a transfer's fee takes a new title when its money is unchanged",
		async (name) => {
			const id = await feeRow(w.userId);
			const row = await stored(id);
			const same = {
				title: "Bank fee",
				amount: "1500",
				currency: "ARS",
				date: row?.date.toISOString().slice(0, 10) ?? DAY,
				categoryId: row?.categoryId ?? w.food,
			};
			expect(await w[name].update(id, same)).toEqual({ ok: true });
			expect(await stored(id)).toMatchObject({ title: "Bank fee" });
			expect((await stored(id))?.amount.toFixed(2)).toBe("1500.00");
		},
	);
});

describe("the rate of an edit", () => {
	const official = (extra: Partial<Fields> = {}) =>
		lunch(w, { rateType: "official", ...extra });
	const home = async (id: string) => {
		const row = await stored(id);
		return {
			type: row?.rateType,
			home: row?.homeAmount?.toFixed(2),
			usd: row?.amountInUSD.toFixed(2),
		};
	};
	const OFFICIAL_100 = { type: "official", home: "141200.00", usd: "100.00" };

	it.each(NAMES)(
		"%s: is kept when the edit sends no rate: USD 120 at the kept Official is ARS 169,440, not Blue's 176,160",
		async (name) => {
			const id = await book(w.userId, official());
			expect(await home(id)).toEqual(OFFICIAL_100);
			expect(await w[name].update(id, lunch(w, { amount: "120" }))).toEqual({
				ok: true,
			});
			expect(await home(id)).toEqual({
				type: "official",
				home: "169440.00",
				usd: "120.00",
			});
		},
	);

	it.each(NAMES)(
		"%s: is booked again when a different type is sent: USD 120 at Blue is ARS 176,160",
		async (name) => {
			const id = await book(w.userId, official());
			expect(
				await w[name].update(id, lunch(w, { amount: "120", rateType: "blue" })),
			).toEqual({ ok: true });
			expect(await home(id)).toEqual({
				type: "blue",
				home: "176160.00",
				usd: "120.00",
			});
		},
	);

	it.each(NAMES)(
		"%s: is kept when only the title changes and the same type is sent",
		async (name) => {
			const id = await book(w.userId, official());
			expect(await w[name].update(id, official({ title: "Renamed" }))).toEqual({
				ok: true,
			});
			expect(await home(id)).toEqual(OFFICIAL_100);
		},
	);

	it.each(NAMES)(
		"%s: is replaced by a typed rate: USD 100 at 1,500 is ARS 150,000",
		async (name) => {
			const id = await book(w.userId, official());
			expect(
				await w[name].update(id, lunch(w, { customRate: "1500" })),
			).toEqual({ ok: true });
			expect(await home(id)).toEqual({
				type: "custom",
				home: "150000.00",
				usd: "100.00",
			});
		},
	);

	it.each(NAMES)(
		"%s: a refused edit books nothing: a currency with no rate keeps the Official booking",
		async (name) => {
			const id = await book(w.userId, official());
			const out = await expectUnchanged(id, () =>
				w[name].update(id, lunch(w, { currency: "BTN" })),
			);
			expect(out).toEqual(MISSING_RATE[name]);
			expect(await home(id)).toEqual(OFFICIAL_100);
		},
	);
});

describe("excludeFromAnalytics against the category's default", () => {
	const flag = async (id: string) => (await stored(id))?.excludeFromAnalytics;

	const created = [
		["the category's default", "hold", undefined, true],
		["a sent false over the default", "hold", false, false],
		["a sent true", "food", true, true],
		["nothing sent, no default", "food", undefined, false],
	] as const;
	const createRows = NAMES.flatMap((n) =>
		created.map((c) => [n, ...c] as const),
	);
	it.each(createRows)(
		"%s create: %s",
		async (name, _what, category, sent, want) => {
			const id = randomUUID();
			const f = lunch(w, {
				categoryId: category === "hold" ? w.holdByDefault : w.food,
				...(sent === undefined ? {} : { excludeFromAnalytics: sent }),
			});
			expect(await w[name].create(id, f)).toEqual({ ok: true });
			expect(await flag(id)).toBe(want);
		},
	);

	it.each(NAMES)(
		"%s: update: a changed category applies its default",
		async (name) => {
			const id = await book(w.userId, lunch(w));
			expect(
				await w[name].update(id, lunch(w, { categoryId: w.holdByDefault })),
			).toEqual({ ok: true });
			expect(await flag(id)).toBe(true);
		},
	);

	it.each(NAMES)(
		"%s: update: a sent flag wins over the changed category's default",
		async (name) => {
			const id = await book(w.userId, lunch(w));
			expect(
				await w[name].update(
					id,
					lunch(w, {
						categoryId: w.holdByDefault,
						excludeFromAnalytics: false,
					}),
				),
			).toEqual({ ok: true });
			expect(await flag(id)).toBe(false);
		},
	);

	it.each(NAMES)(
		"%s: update: an unchanged category does not apply its default",
		async (name) => {
			const id = await book(
				w.userId,
				lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: false }),
			);
			expect(
				await w[name].update(
					id,
					lunch(w, { title: "Same", categoryId: w.holdByDefault }),
				),
			).toEqual({ ok: true });
			expect(await flag(id)).toBe(false);
		},
	);

	it.each(NAMES)(
		"%s: update: a flag left out is kept, also when the category changes to a plain one",
		async (name) => {
			const on = await book(w.userId, lunch(w, { excludeFromAnalytics: true }));
			expect(
				await w[name].update(
					on,
					lunch(w, { title: "Out of it", categoryId: w.food }),
				),
			).toEqual({ ok: true });
			expect(await flag(on)).toBe(true);

			const moved = await book(
				w.userId,
				lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: true }),
			);
			expect(
				await w[name].update(moved, lunch(w, { categoryId: w.food })),
			).toEqual({ ok: true });
			expect(await flag(moved)).toBe(true);
		},
	);
});

describe("the day is read in the user's zone", () => {
	/** A USD-home user whose stored zone is `zone`, so no rate stands between the day and the row. */
	async function zoned(zone: string) {
		const user = await arsUser();
		await adminDb.user.update({
			where: { id: user.user.id },
			data: { homeCurrency: "USD", timeZone: zone },
		});
		const cat = await fixtureDb.category.create({
			data: {
				userId: user.user.id,
				name: `Z ${zone}`,
				color: "teal",
				kind: "EXPENSE",
			},
		});
		const http = await asMobile(user.user.id);
		return {
			id: user.user.id,
			categoryId: cat.id,
			t: transportsOf(user.user.id, user.db, http, zone),
		};
	}
	const at = async (id: string) => (await stored(id))?.date.toISOString();
	const form = (categoryId: string, date: string): Fields => ({
		title: "Late",
		amount: "10",
		currency: "USD",
		date,
		categoryId,
	});

	const kathmandu = {
		entry: "2026-10-31T18:15:00.000Z",
		v1: "2026-10-31T18:15:00.000Z",
		legacy: "2026-11-01T00:00:00.000Z",
	};
	it.each(NAMES)(
		"%s: Kathmandu (UTC+5:45) books 2026-11-01 as the instant in its table (legacy keeps the instant sent)",
		async (name) => {
			const z = await zoned("Asia/Kathmandu");
			const id = randomUUID();
			expect(
				await z.t[name].create(id, form(z.categoryId, "2026-11-01")),
			).toEqual({ ok: true });
			expect(await at(id)).toBe(kathmandu[name]);
		},
	);

	it.each(["entry", "v1"] as const)(
		"%s: Buenos Aires (UTC-3): an edit from 2026-10-31 to 2026-11-01 moves the row to 03:00Z",
		async (name) => {
			const z = await zoned("America/Argentina/Buenos_Aires");
			const t = z.t[name];
			const id = randomUUID();
			expect(await t.create(id, form(z.categoryId, "2026-10-31"))).toEqual({
				ok: true,
			});
			expect(await at(id)).toBe("2026-10-31T03:00:00.000Z");
			expect(await t.update(id, form(z.categoryId, "2026-11-01"))).toEqual({
				ok: true,
			});
			expect(await at(id)).toBe("2026-11-01T03:00:00.000Z");
		},
	);
});
