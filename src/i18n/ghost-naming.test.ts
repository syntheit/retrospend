import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locales";

/**
 * A ghost (a person with no account) used to appear under two names in the
 * same row: the badge said "Ghost · no account" and the line under the name
 * said "Shadow profile · No account yet". The badge carries the name; the
 * subline only says there is no account yet.
 */
function projectsCatalog(locale: string): Record<string, string> {
	const raw = readFileSync(`packages/i18n/messages/${locale}.json`, "utf8");
	return (JSON.parse(raw) as { projects: Record<string, string> }).projects;
}

describe("ghost naming", () => {
	it.each(SUPPORTED_LOCALES)("%s: the no-account subline names no one", (locale) => {
		const projects = projectsCatalog(locale);
		expect(projects.shadowProfileNoAccount).toBeDefined();
		// No "<name> · <note>" pair: just the note.
		expect(projects.shadowProfileNoAccount).not.toContain("·");
	});

	it("en: the add button uses the same name as the badge", () => {
		const projects = projectsCatalog("en");
		expect(projects.ghostBadge).toMatch(/^Ghost/);
		expect(projects.addAsShadowProfile).toBe("Add as ghost");
		expect(projects.shadowProfileNoAccount).not.toMatch(/shadow/i);
	});
});
