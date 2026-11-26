import { MERGE_REFUSALS } from "@retrospend/domain/category-merge/refusals";
import { describe, expect, it } from "vitest";
import en from "../../../../packages/i18n/messages/en/settingsV2.json";
import { removeRefusalOf } from "./remove-refusal";

describe("removeRefusalOf", () => {
	it("knows every code the merge refuses with, and has a sentence for each", () => {
		const sentences = en.categories.remove.refusals as Record<string, string>;
		for (const code of Object.keys(MERGE_REFUSALS)) {
			expect(removeRefusalOf({ data: { problem: code } })).toBe(code);
			expect(sentences[code]).toMatch(/\S/);
		}
		expect(Object.keys(sentences).sort()).toEqual(
			Object.keys(MERGE_REFUSALS).sort(),
		);
	});

	it("is null for any other failure, whatever its message says", () => {
		expect(removeRefusalOf(new Error("category_kind_mismatch"))).toBeNull();
		expect(
			removeRefusalOf({ data: { problem: "text_unavailable" } }),
		).toBeNull();
		expect(removeRefusalOf(null)).toBeNull();
	});
});
