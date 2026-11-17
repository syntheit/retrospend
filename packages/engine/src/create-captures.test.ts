import { describe, expect, it } from "vitest";
import {
	CAPTURE_TTL_MS,
	CreateCaptures,
	MAX_CAPTURES,
	type SentCreate,
} from "./create-captures";
import { SETTINGS_ID, type SettingsRow } from "./port";
import { rateDefaultsKey } from "./write-parity";

const settings: SettingsRow = {
	id: SETTINGS_ID,
	homeCurrency: "ARS",
	timeZone: "America/Argentina/Buenos_Aires",
	startDay: 1,
	hiddenProjectIds: [],
	defaultRateTypes: { ARS: "blue" },
};

const sent = (over: Partial<SentCreate> = {}): SentCreate => ({
	id: "e1",
	kind: "expense",
	body: { amount: "100", currency: "USD", date: "2026-03-05" },
	at: 1_000,
	...over,
});

const bound = (row: SettingsRow | null = settings) => {
	const c = new CreateCaptures(() => 1_000);
	c.bind(() => row ?? undefined);
	return c;
};

describe("holding a create", () => {
	it("keeps the zone and rate types of the settings when it was sent", () => {
		const c = bound();
		expect(c.add(sent())).toBe(true);
		expect(c.pending()).toEqual([
			{
				id: "e1",
				kind: "expense",
				body: { amount: "100", currency: "USD", date: "2026-03-05" },
				zone: "America/Argentina/Buenos_Aires",
				homeCurrency: "ARS",
				rateDefaults: rateDefaultsKey(settings),
				at: 1_000,
			},
		]);
	});

	it("keeps only the fields that decide the booking, never a title, location or note", () => {
		const c = bound();
		c.add(
			sent({
				body: {
					id: "e1",
					title: "Secret lunch",
					description: "with Zelda",
					location: "Cafe Roma",
					notes: "n",
					amount: "100",
					currency: "USD",
					date: "2026-03-05",
					categoryId: "cat",
					rateType: "official",
					customRate: "1200",
					excludeFromAnalytics: true,
					amortizeOver: 3,
				},
			}),
		);
		const held = c.pending()[0];
		expect(held?.body).toEqual({
			amount: "100",
			currency: "USD",
			date: "2026-03-05",
			categoryId: "cat",
			rateType: "official",
			customRate: "1200",
			excludeFromAnalytics: true,
			amortizeOver: 3,
		});
		expect(JSON.stringify(held)).not.toMatch(/Secret|Zelda|Roma/);
	});

	it("holds no body for a split or a transfer", () => {
		const c = bound();
		expect(
			c.add(sent({ kind: "split", body: { title: "t", amount: "1" } })),
		).toBe(true);
		expect(c.pending()[0]?.body).toBeUndefined();
	});

	it("refuses a create it cannot book later: no settings, or a body without its amount, currency or day", () => {
		expect(bound(null).add(sent())).toBe(false);
		expect(new CreateCaptures().add(sent())).toBe(false);
		for (const body of [
			{ currency: "USD", date: "2026-03-05" },
			{ amount: "1", date: "2026-03-05" },
			{ amount: "1", currency: "USD" },
			{ amount: 1, currency: "USD", date: "2026-03-05" },
			null,
		])
			expect(bound().add(sent({ body }))).toBe(false);
	});

	it("replaces a create with the same id", () => {
		const c = bound();
		c.add(sent({ at: 1 }));
		c.add(sent({ at: 2 }));
		expect(c.pending().map((x) => x.at)).toEqual([2]);
	});

	it("drops the oldest past the cap", () => {
		const c = bound();
		for (let i = 0; i <= MAX_CAPTURES; i += 1) c.add(sent({ id: `e${i}` }));
		const ids = c.pending().map((x) => x.id);
		expect(ids).toHaveLength(MAX_CAPTURES);
		expect(ids[0]).toBe("e1");
		expect(ids.at(-1)).toBe(`e${MAX_CAPTURES}`);
	});

	it("moves a re-added create to the newest place, so the cap drops another first", () => {
		const c = bound();
		for (let i = 0; i < MAX_CAPTURES; i += 1) c.add(sent({ id: `e${i}` }));
		c.add(sent({ id: "e0" }));
		c.add(sent({ id: "new" }));
		const ids = c.pending().map((x) => x.id);
		expect(ids).toContain("e0");
		expect(ids).not.toContain("e1");
	});

	it("drops one by id", () => {
		const c = bound();
		c.add(sent());
		c.drop("e1");
		expect(c.pending()).toEqual([]);
	});
});

describe("the time limit", () => {
	const clock = (start: number) => {
		const t = { now: start };
		const c = new CreateCaptures(() => t.now);
		c.bind(() => settings);
		return { t, c };
	};

	it("drops what is older than the limit, keeping what is exactly at it", () => {
		const { t, c } = clock(0);
		c.add(sent({ id: "old", at: 0 }));
		c.add(sent({ id: "edge", at: 1 }));
		t.now = CAPTURE_TTL_MS + 1;
		expect(c.pending().map((x) => x.id)).toEqual(["edge"]);
		expect(c.takeExpired()).toBe(1);
		expect(c.takeExpired()).toBe(0);
	});

	it("drops on add, without anyone reading", () => {
		const { t, c } = clock(0);
		c.add(sent({ id: "old", at: 0 }));
		t.now = CAPTURE_TTL_MS + 1;
		c.add(sent({ id: "new", at: t.now }));
		expect(c.takeExpired()).toBe(1);
		expect(c.pending().map((x) => x.id)).toEqual(["new"]);
	});

	it("forgets everything on clear, expired count included", () => {
		const { t, c } = clock(0);
		c.add(sent({ id: "old", at: 0 }));
		c.add(sent({ id: "old2", at: 0 }));
		t.now = CAPTURE_TTL_MS + 1;
		c.pending();
		c.clear();
		expect(c.pending()).toEqual([]);
		expect(c.takeExpired()).toBe(0);
	});
});
