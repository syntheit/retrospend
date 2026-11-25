import { describe, expect, it } from "vitest";
import { fixtureRow } from "./fixtures";
import {
	TEMPLATE_JOINED_COLUMNS,
	TEMPLATE_STRIPPED_COLUMNS,
	TEMPLATE_TEXT_COLUMNS,
	templateWithoutText,
} from "./templates";

describe("templateWithoutText", () => {
	const row = {
		...fixtureRow("recurringTemplates", "t1"),
		websiteUrl: "SECRET-site",
		paymentSource: "SECRET-source",
		category: { id: "c1", name: "SECRET-cat", color: "teal", icon: null },
		categoryId: "c1",
		version: "2026-10-02T12:00:00.000Z",
	};

	it("drops the name, website, payment source and the joined category", () => {
		const bare = templateWithoutText(row);
		for (const column of TEMPLATE_STRIPPED_COLUMNS)
			expect(bare, column).not.toHaveProperty(column);
		expect(JSON.stringify(bare)).not.toContain("SECRET");
		expect(JSON.stringify(bare)).not.toContain("Rent");
	});

	it("keeps every other column, the version and the category id included", () => {
		expect(templateWithoutText(row)).toEqual({
			id: "t1",
			amount: "300000",
			currency: "ARS",
			frequency: "MONTHLY",
			nextDueDate: row.nextDueDate,
			anchorDay: 1,
			direction: "OUT",
			isActive: true,
			autoPay: false,
			amountMode: "FIXED",
			categoryId: "c1",
			version: "2026-10-02T12:00:00.000Z",
		});
	});

	it("strips the text columns and the joined ones, in that order", () => {
		expect([...TEMPLATE_STRIPPED_COLUMNS]).toEqual([
			...TEMPLATE_TEXT_COLUMNS,
			...TEMPLATE_JOINED_COLUMNS,
		]);
	});
});
