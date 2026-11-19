import { describe, expect, it } from "vitest";
import { monthVerdictIncomplete } from "./verdict";

describe("monthVerdictIncomplete", () => {
	const month = (
		incomplete: boolean,
		approximate: boolean,
		verdict: boolean,
	) => ({
		incomplete,
		approximate,
		verdict: { incomplete: verdict },
	});

	it("is false only when the month, its approximation and the verdict are all complete", () => {
		expect(monthVerdictIncomplete(month(false, false, false))).toBe(false);
	});

	it.each([
		["the month", month(true, false, false)],
		["approximate", month(false, true, false)],
		["the verdict", month(false, false, true)],
	])("is true when %s is the one that says so", (_name, m) => {
		expect(monthVerdictIncomplete(m)).toBe(true);
	});
});
