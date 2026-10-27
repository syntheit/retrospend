import { CATEGORY_ICON_NAMES } from "@retrospend/domain/category-icons";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICON_REGISTRY } from "./category-icons";

describe("category icon registry", () => {
	it("draws exactly the keys the apps draw", () => {
		expect(Object.keys(CATEGORY_ICON_REGISTRY).sort()).toEqual(
			[...CATEGORY_ICON_NAMES].sort(),
		);
	});
});
