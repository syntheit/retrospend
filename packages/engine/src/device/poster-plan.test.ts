import { describe, expect, it, vi } from "vitest";
import { createDeviceEngine } from "./engine";
import { cursor, fakeDeviceApi, template } from "./fake-api";

// The poster's plan over the pulled rows. Home is ARS in Buenos Aires (UTC-3),
// blue 1,545 from Dec 1, "now" 2026-12-01T03:05Z; the template is USD 20
// monthly due 2026-12-01T03:00Z, so one period is due and books ARS 30,900.00.
const NOW = Date.parse("2026-12-01T03:05:00.000Z");
const page = (items: unknown[]) => ({
	items,
	tombstones: [],
	cursor: cursor("100"),
	hasMore: false,
});
const rates = {
	asOf: "2026-12-01T00:00:00.000Z",
	rates: [
		{
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-12-01T00:00:00.000Z",
			unitsPerUsd: "1545",
		},
	],
};
const plan = (autoPost: boolean, skip: string[] = [], income = true) => ({
	autoPost,
	income,
	isProtected: async () => false,
	skip: new Set(skip),
});

function engine() {
	const { api } = fakeDeviceApi({
		rates,
		expenses: [page([])],
		transfers: [page([])],
		templates: [page([template("t1"), template("t2", { name: "Gym" })])],
	});
	return createDeviceEngine(api, "u1", () => NOW, { warn: vi.fn() });
}

describe("DeviceEngine.planPoster", () => {
	it("plans one entry per due template, with the name and currency for the Sync issues row", async () => {
		const e = engine();
		await e.pull();
		const plans = await e.planPoster(plan(true));
		expect(plans?.map((p) => [p.templateId, p.title, p.currency])).toEqual([
			["t1", "Rent", "USD"],
			["t2", "Gym", "USD"],
		]);
		expect(plans?.[0]?.run.entries).toHaveLength(1);
	});

	it("plans nothing when auto-post is off", async () => {
		const e = engine();
		await e.pull();
		expect(await e.planPoster(plan(false))).toEqual([]);
	});

	it("leaves out a skipped template", async () => {
		const e = engine();
		await e.pull();
		const plans = await e.planPoster(plan(true, ["t1"]));
		expect(plans?.map((p) => p.templateId)).toEqual(["t2"]);
	});

	// The domain plans an income template as the server's sweep posts it
	// (poster.test.ts), and the phone sends it with `auto`.
	it("plans an income template as it plans an expense one", async () => {
		const { api } = fakeDeviceApi({
			rates,
			expenses: [page([])],
			transfers: [page([])],
			templates: [page([template("t1"), template("t3", { direction: "IN" })])],
		});
		const e = createDeviceEngine(api, "u1", () => NOW, { warn: vi.fn() });
		await e.pull();
		const plans = await e.planPoster(plan(true));
		expect(plans?.map((p) => p.templateId)).toEqual(["t1", "t3"]);
		expect(plans?.[1]?.run.entries).toHaveLength(1);
	});

	it("leaves an income template out when the server does not take auto, and plans the expense one as ever", async () => {
		const { api } = fakeDeviceApi({
			rates,
			expenses: [page([])],
			transfers: [page([])],
			templates: [page([template("t1"), template("t3", { direction: "IN" })])],
		});
		const e = createDeviceEngine(api, "u1", () => NOW, { warn: vi.fn() });
		await e.pull();
		const plans = await e.planPoster(plan(true, [], false));
		expect(plans?.map((p) => p.templateId)).toEqual(["t1"]);
	});

	it("answers null before the first pull and after dispose, never a plan on a guess", async () => {
		const e = engine();
		expect(await e.planPoster(plan(true))).toBeNull();
		await e.pull();
		await e.dispose({ wipe: true });
		expect(await e.planPoster(plan(true))).toBeNull();
	});
});
