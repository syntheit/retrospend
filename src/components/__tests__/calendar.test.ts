import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Calendar } from "~/components/ui/calendar";

const month = new Date(2026, 2, 1);
const selected = new Date(2026, 2, 14);

describe("Calendar (react-day-picker v10)", () => {
	it("renders the shadcn wrapper with the selected day marked", () => {
		const html = renderToStaticMarkup(
			createElement(Calendar, { mode: "single", month, selected }),
		);
		expect(html).toContain('data-slot="calendar"');
		expect(html).toContain("rdp-month_grid");
		expect(html).toContain("rdp-button_previous");
		expect(html).toContain("rdp-button_next");
		expect(html).toMatch(/data-selected-single="true"[^>]*>14</);
	});

	it("limits the dropdowns with startMonth and endMonth", () => {
		const html = renderToStaticMarkup(
			createElement(Calendar, {
				captionLayout: "dropdown",
				mode: "single",
				month,
				selected,
				startMonth: new Date(2020, 0),
				endMonth: new Date(2030, 11),
			}),
		);
		const years = [...html.matchAll(/<option value="(\d{4})"/g)].map((m) =>
			Number(m[1]),
		);
		expect(years[0]).toBe(2020);
		expect(years.at(-1)).toBe(2030);
		expect(html).toContain("rdp-months_dropdown");
	});
});
