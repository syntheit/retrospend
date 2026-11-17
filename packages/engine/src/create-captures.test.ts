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
	const c = new CreateCaptures();
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

	it("drops one by id", () => {
		const c = bound();
		c.add(sent());
		c.drop("e1");
		expect(c.pending()).toEqual([]);
	});
});

describe("the time limit", () => {
	it("drops what is older than the limit and counts it, keeping what is exactly at it", () => {
		const c = bound();
		c.add(sent({ id: "old", at: 0 }));
		c.add(sent({ id: "edge", at: 1 }));
		expect(c.prune(CAPTURE_TTL_MS + 1)).toBe(1);
		expect(c.pending().map((x) => x.id)).toEqual(["edge"]);
		expect(c.prune(CAPTURE_TTL_MS + 1)).toBe(0);
	});
});
