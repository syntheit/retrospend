import type { PreviewDto } from "@/features/entry/preview";
import { canSelect, entityIdsOf, mergeDeletePreviews } from "./bulk";
import type { ActivityItem } from "./source";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Coffee",
	category: null,
	amount: { minor: 1000, currency: "ARS" },
	sortKey: 1000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
	...over,
});

describe("canSelect", () => {
	it("picks only your own editable personal expenses", () => {
		expect(canSelect(item())).toBe(true);
		expect(canSelect(item({ source: "shared" }))).toBe(false);
		expect(canSelect(item({ source: "payment", kind: "payment" }))).toBe(false);
		expect(canSelect(item({ kind: "income" }))).toBe(false);
		expect(canSelect(item({ kind: "transfer" }))).toBe(false);
		expect(canSelect(item({ mine: false }))).toBe(false);
		expect(canSelect(item({ canEdit: false }))).toBe(false);
	});
});

describe("entityIdsOf", () => {
	it("maps the picked rows to their entry ids, in list order", () => {
		const rows = [
			item({ id: "a", entityId: "ea" }),
			item({ id: "b", entityId: "eb" }),
			item({ id: "c", entityId: "ec" }),
		];
		expect(entityIdsOf(rows, new Set(["c", "a"]))).toEqual(["ea", "ec"]);
	});
});

const line = (minor: number) => ({ minor, currency: "ARS" });
const spent = (
	delta: number,
	before: number,
): PreviewDto["changes"][number] => ({
	id: "spent",
	currency: "ARS",
	before: line(before),
	after: line(before + delta),
	delta: line(delta),
	figureAfter: [line(before + delta)],
});
const diff = (over: Partial<PreviewDto> = {}): PreviewDto => ({
	changes: [],
	unchanged: [],
	unavailable: [],
	...over,
});

describe("mergeDeletePreviews", () => {
	it("passes one answer through as it came", () => {
		const one = diff({ changes: [spent(-500, 2000)] });
		expect(mergeDeletePreviews([one])).toBe(one);
	});

	it("adds each figure's deltas and drops the after it cannot know", () => {
		const merged = mergeDeletePreviews([
			diff({ changes: [spent(-500, 2000)] }),
			diff({ changes: [spent(-300, 2000)] }),
		]);
		expect(merged.changes).toHaveLength(1);
		expect(merged.changes[0]?.delta).toEqual(line(-800));
		expect(merged.changes[0]?.after).toBeNull();
	});

	it("keeps currencies apart", () => {
		const usd = {
			...spent(-100, 900),
			currency: "USD",
			delta: { minor: -100, currency: "USD" },
		};
		const merged = mergeDeletePreviews([
			diff({ changes: [spent(-500, 2000)] }),
			diff({ changes: [usd] }),
		]);
		expect(merged.changes.map((c) => c.currency).sort()).toEqual([
			"ARS",
			"USD",
		]);
	});

	it("says a figure stays only when every dry run found it unchanged", () => {
		const stays = (id: string) => ({ id, lines: [line(1)] });
		const merged = mergeDeletePreviews([
			diff({ unchanged: [stays("netWorth"), stays("owed.owedToYou")] }),
			diff({ unchanged: [stays("owed.owedToYou")] }),
		]);
		expect(merged.unchanged.map((u) => u.id)).toEqual(["owed.owedToYou"]);
	});

	it("passes on a figure that could not be read in any of them", () => {
		const merged = mergeDeletePreviews([
			diff(),
			diff({ unavailable: [{ id: "spent", before: null, after: null }] }),
		]);
		expect(merged.unavailable.map((u) => u.id)).toEqual(["spent"]);
	});
});
