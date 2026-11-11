/**
 * A TITLE rule's text as the rule reads it. The client opens a sealed text
 * before this sees it (field-open.ts, covered in rules-title.pg.test.ts).
 */
import { describe, expect, it } from "vitest";
import type { IncomeRule as RuleRow } from "~prisma";
import { matchOf } from "./rule-store";

const row = (over: Partial<RuleRow>) => ({ id: "r1", ...over }) as RuleRow;

describe("matchOf", () => {
	it("reads a TITLE rule's text as is", () => {
		const r = row({ matchKind: "TITLE", matchTitle: "Café" });
		expect(matchOf(r)).toEqual({ kind: "TITLE", contains: "Café" });
	});

	it("a missing text is empty, which matches every title, as before", () => {
		expect(matchOf(row({ matchKind: "TITLE", matchTitle: null }))).toEqual({
			kind: "TITLE",
			contains: "",
		});
	});

	it("reads other kinds from their value", () => {
		expect(matchOf(row({ matchKind: "CURRENCY", matchValue: "ARS" }))).toEqual({
			kind: "CURRENCY",
			currency: "ARS",
		});
	});
});
