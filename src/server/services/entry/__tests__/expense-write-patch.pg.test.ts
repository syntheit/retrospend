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
	makeWorld,
	spreadRow,
	stored,
	type Transport,
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
	it("clears a location, a description and a spread that are left out, and keeps excludeFromAnalytics", async () => {
		for (const t of w.transports) {
			const id = await book(
				w.userId,
				lunch(w, {
					location: "Cafe",
					description: "Menu",
					excludeFromAnalytics: true,
				}),
			);
			expect(
				await t.update(id, NO_OPTIONALS(lunch(w, { title: "Bare" }))),
				t.name,
			).toEqual({ ok: true });
			expect(await stored(id), t.name).toMatchObject({
				title: "Bare",
				location: null,
				description: null,
				categoryId: w.food,
				excludeFromAnalytics: true,
			});
		}
	});

	it("clears the category when it is left out, where the transport allows that (v1, legacy)", async () => {
		for (const t of [w.v1, w.legacy]) {
			const id = await book(w.userId, lunch(w));
			expect(
				await t.update(id, {
					...NO_OPTIONALS(lunch(w)),
					categoryId: undefined,
				}),
				t.name,
			).toEqual({ ok: true });
			expect((await stored(id))?.categoryId, t.name).toBeNull();
		}
	});

	it("takes the spread parts away when amortizeOver is left out, and re-spreads when it is sent", async () => {
		for (const t of w.transports) {
			const { id, parts } = await spreadRow(w);
			expect(parts).toHaveLength(3);
			expect(
				await t.update(id, lunch(w, { amount: "120", amortizeOver: 4 })),
				t.name,
			).toEqual({ ok: true });
			expect((await stored(id))?.children, `${t.name} respread`).toHaveLength(
				4,
			);
			expect(await t.update(id, lunch(w, { amount: "120" })), t.name).toEqual({
				ok: true,
			});
			expect(await stored(id), t.name).toMatchObject({
				isAmortizedParent: false,
				children: [],
			});
		}
	});

	it("a transfer's fee takes a new title when its money is unchanged", async () => {
		for (const t of [w.entry, w.v1]) {
			const id = await feeRow(w.userId);
			const row = await stored(id);
			const same = {
				title: "Bank fee",
				amount: "1500",
				currency: "ARS",
				date: row?.date.toISOString().slice(0, 10) ?? DAY,
				categoryId: row?.categoryId ?? w.food,
			};
			expect(await t.update(id, same), t.name).toEqual({ ok: true });
			expect(await stored(id), t.name).toMatchObject({ title: "Bank fee" });
			expect((await stored(id))?.amount.toFixed(2), t.name).toBe("1500.00");
		}
	});
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

	it("is kept when the edit sends no rate: USD 120 at the kept Official is ARS 169,440, not Blue's 176,160", async () => {
		for (const t of w.transports) {
			const id = await book(w.userId, official());
			expect(await home(id), `${t.name} booked`).toEqual({
				type: "official",
				home: "141200.00",
				usd: "100.00",
			});
			expect(await t.update(id, lunch(w, { amount: "120" })), t.name).toEqual({
				ok: true,
			});
			expect(await home(id), t.name).toEqual({
				type: "official",
				home: "169440.00",
				usd: "120.00",
			});
		}
	});

	it("is booked again when a different type is sent: USD 120 at Blue is ARS 176,160", async () => {
		for (const t of w.transports) {
			const id = await book(w.userId, official());
			expect(
				await t.update(id, lunch(w, { amount: "120", rateType: "blue" })),
				t.name,
			).toEqual({ ok: true });
			expect(await home(id), t.name).toEqual({
				type: "blue",
				home: "176160.00",
				usd: "120.00",
			});
		}
	});

	it("is kept when only the title changes and the same type is sent", async () => {
		for (const t of w.transports) {
			const id = await book(w.userId, official());
			expect(
				await t.update(id, official({ title: "Renamed" })),
				t.name,
			).toEqual({ ok: true });
			expect(await home(id), t.name).toEqual({
				type: "official",
				home: "141200.00",
				usd: "100.00",
			});
		}
	});

	it("is replaced by a typed rate: USD 100 at 1,500 is ARS 150,000", async () => {
		for (const t of w.transports) {
			const id = await book(w.userId, official());
			expect(
				await t.update(id, lunch(w, { customRate: "1500" })),
				t.name,
			).toEqual({ ok: true });
			expect(await home(id), t.name).toEqual({
				type: "custom",
				home: "150000.00",
				usd: "100.00",
			});
		}
	});

	it("a refused edit books nothing: a currency with no rate keeps the Official booking", async () => {
		for (const t of w.transports) {
			const id = await book(w.userId, official());
			const out = await expectUnchanged(id, () =>
				t.update(id, lunch(w, { currency: "BTN" })),
			);
			expect(out.ok, t.name).toBe(false);
		}
	});
});

describe("excludeFromAnalytics against the category's default", () => {
	const flag = async (id: string) => (await stored(id))?.excludeFromAnalytics;

	it("create: the sent flag wins, else the category's default, else false", async () => {
		const cases = [
			[{ categoryId: "hold" }, true],
			[{ categoryId: "hold", excludeFromAnalytics: false }, false],
			[{ categoryId: "food", excludeFromAnalytics: true }, true],
			[{ categoryId: "food" }, false],
		] as const;
		for (const t of w.transports)
			for (const [pick, want] of cases) {
				const id = randomUUID();
				const f = lunch(w, {
					categoryId: pick.categoryId === "hold" ? w.holdByDefault : w.food,
					...("excludeFromAnalytics" in pick
						? { excludeFromAnalytics: pick.excludeFromAnalytics }
						: {}),
				});
				expect(await t.create(id, f), t.name).toEqual({ ok: true });
				expect(await flag(id), `${t.name} ${JSON.stringify(pick)}`).toBe(want);
			}
	});

	it("update: a changed category applies its default unless the flag is sent", async () => {
		for (const t of w.transports) {
			const none = await book(w.userId, lunch(w));
			await t.update(none, lunch(w, { categoryId: w.holdByDefault }));
			expect(await flag(none), `${t.name} default applies`).toBe(true);

			const sent = await book(w.userId, lunch(w));
			await t.update(
				sent,
				lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: false }),
			);
			expect(await flag(sent), `${t.name} sent wins`).toBe(false);
		}
	});

	it("update: an unchanged category does not apply its default, and a flag left out is kept", async () => {
		for (const t of w.transports) {
			const kept = await book(
				w.userId,
				lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: false }),
			);
			await t.update(
				kept,
				lunch(w, { title: "Same", categoryId: w.holdByDefault }),
			);
			expect(await flag(kept), `${t.name} unchanged category`).toBe(false);

			const on = await book(w.userId, lunch(w, { excludeFromAnalytics: true }));
			await t.update(on, lunch(w, { title: "Out of it", categoryId: w.food }));
			expect(await flag(on), `${t.name} left out`).toBe(true);

			const moved = await book(
				w.userId,
				lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: true }),
			);
			await t.update(moved, lunch(w, { categoryId: w.food }));
			expect(await flag(moved), `${t.name} moved to a plain category`).toBe(
				true,
			);
		}
	});
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

	it("Kathmandu (UTC+5:45): 2026-11-01 is 2026-10-31T18:15Z on tRPC and v1, the instant sent on legacy", async () => {
		const z = await zoned("Asia/Kathmandu");
		const want = {
			entry: "2026-10-31T18:15:00.000Z",
			v1: "2026-10-31T18:15:00.000Z",
			legacy: "2026-11-01T00:00:00.000Z",
		};
		for (const t of Object.values(z.t) as Transport[]) {
			const id = randomUUID();
			expect(
				await t.create(id, form(z.categoryId, "2026-11-01")),
				t.name,
			).toEqual({ ok: true });
			expect(await at(id), t.name).toBe(want[t.name]);
		}
	});

	it("Buenos Aires (UTC-3): an edit from 2026-10-31 to 2026-11-01 moves the row to 03:00Z on tRPC and v1", async () => {
		const z = await zoned("America/Argentina/Buenos_Aires");
		for (const t of [z.t.entry, z.t.v1]) {
			const id = randomUUID();
			await t.create(id, form(z.categoryId, "2026-10-31"));
			expect(await at(id), `${t.name} created`).toBe(
				"2026-10-31T03:00:00.000Z",
			);
			expect(
				await t.update(id, form(z.categoryId, "2026-11-01")),
				t.name,
			).toEqual({ ok: true });
			expect(await at(id), `${t.name} edited`).toBe("2026-11-01T03:00:00.000Z");
		}
	});
});
