import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "~/lib/nav";
import {
	activeSection,
	isSectionId,
	SECTIONS,
	sectionFromHash,
} from "../sections";

describe("sections", () => {
	it("has an anchor for every section the shell and palette link", () => {
		for (const id of SETTINGS_SECTIONS) expect(isSectionId(id)).toBe(true);
	});

	it("ends with the danger zone and includes Developer", () => {
		expect(SECTIONS.at(-1)).toBe("danger");
		expect(SECTIONS).toContain("developer");
	});

	it("reads a section from the hash", () => {
		expect(sectionFromHash("#security")).toBe("security");
		expect(sectionFromHash("security")).toBe("security");
		expect(sectionFromHash("#nope")).toBeNull();
		expect(sectionFromHash("")).toBeNull();
	});
});

describe("activeSection", () => {
	const tops = [
		{ id: "profile", top: -400 },
		{ id: "preferences", top: 40 },
		{ id: "categories", top: 600 },
	] as const;

	it("is the last section whose top passed the reading line", () => {
		expect(activeSection(tops, 96, false)).toBe("preferences");
		expect(activeSection(tops, 20, false)).toBe("profile");
	});

	it("is the first section before any reaches the line", () => {
		expect(activeSection([{ id: "profile", top: 200 }], 96, false)).toBe(
			"profile",
		);
	});

	it("is the last section at the end of the page", () => {
		expect(activeSection(tops, 96, true)).toBe("categories");
	});

	it("is null with no sections", () => {
		expect(activeSection([], 96, false)).toBeNull();
	});
});
