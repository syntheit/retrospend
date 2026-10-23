// Server-rendered markup of the S1b components: names, roving focus and
// identity without a DOM (vitest runs in node here).
import { NextIntlClientProvider } from "next-intl";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../../../packages/i18n/src/load";
import { ActionMenu } from "../actions/action-menu";
import { MoneyInput } from "../money/money-input";
import { CategoryPicker } from "../pickers/category-picker";
import { MonthGrid } from "../pickers/month-grid";
import { PersonPicker } from "../pickers/person-picker";

const messages = await loadCatalog("en");
const render = (el: ReactElement) =>
	renderToStaticMarkup(
		h(NextIntlClientProvider, {
			locale: "en",
			messages,
			timeZone: "UTC",
			children: el,
		}),
	);

describe("ActionMenu", () => {
	it("is an icon button named for its target", () => {
		const html = render(
			h(ActionMenu<"person">, {
				entity: "person",
				target: { id: "p1", name: "Lucía" },
				handlers: { settle: vi.fn() },
			}),
		);
		expect(html).toContain('aria-label="More actions for Lucía"');
		expect(html).toContain('aria-haspopup="menu"');
	});

	it("renders nothing when no action has a handler", () => {
		const html = render(
			h(ActionMenu<"person">, {
				entity: "person",
				target: { id: "p1", name: "Lucía" },
				handlers: {},
			}),
		);
		expect(html).toBe("");
	});
});

describe("CategoryPicker", () => {
	const categories = [
		{ id: "c1", name: "Groceries", icon: "ShoppingBasket", tone: 3 },
		{ id: "c2", name: "Café", icon: "Coffee", tone: 7 },
		{ id: "c3", name: "Transport", icon: null, tone: 12 },
	];
	it("recents first, bare glyph in the category color, a Find field", () => {
		const html = render(
			h(CategoryPicker, {
				categories,
				recentIds: ["c2"],
				value: "c3",
				onChange: vi.fn(),
			}),
		);
		expect(html).toContain('placeholder="Find a category"');
		expect(html.indexOf("Recent")).toBeLessThan(html.indexOf("All categories"));
		expect(html.indexOf("Café")).toBeLessThan(html.indexOf("Groceries"));
		expect(html).toContain("color:var(--category-7)");
		expect(html).toContain('data-chosen="true"');
		expect(html).toContain("Selected");
	});
});

describe("PersonPicker", () => {
	it("faces, the Not on Retrospend word and Add person", () => {
		const html = render(
			h(PersonPicker, {
				people: [
					{ id: "p1", name: "Lucía Pérez", onRetrospend: true },
					{ id: "p2", name: "Martín", onRetrospend: false },
				],
				value: ["p1"],
				onChange: vi.fn(),
				onAddPerson: vi.fn(),
			}),
		);
		expect(html).toContain("Not on Retrospend");
		expect(html).toContain("Add person");
		expect(html.match(/data-chosen="true"/g)).toHaveLength(1);
	});
});

describe("MonthGrid", () => {
	const props = {
		month: "2026-10-01",
		today: "2026-10-22",
		lo: "2026-10-05",
		hi: "2026-10-09",
		focusDay: "2026-10-05",
		onFocusDay: vi.fn(),
		onMove: vi.fn(),
		onPick: vi.fn(),
		weekStart: 0 as const,
		title: "October 2026",
		weekdays: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
		dayName: (d: string) => `Day ${d}`,
	};
	it("one day in the tab order, ends pressed, every day named", () => {
		const html = render(h(MonthGrid, props));
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html).toMatch(
			/aria-label="Day 2026-10-05"[^>]*tabindex="0"|tabindex="0"[^>]*aria-label="Day 2026-10-05"/,
		);
		expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
		expect(html.match(/data-day=/g)).toHaveLength(31);
	});
});

describe("MoneyInput", () => {
	const base = { currency: "ARS", onChange: vi.fn() };

	it("a decimal keypad, a named amount and currency, no error while typing", () => {
		const html = render(h(MoneyInput, { ...base, value: "12+" }));
		expect(html).toContain('inputMode="decimal"');
		expect(html).toContain('aria-label="Amount"');
		expect(html).not.toContain('role="alert"');
		// The amount sits on the right, as in the kit.
		expect(html).toContain("text-right");
	});

	it("shows the currency chip: a fixed one as text, a changeable one as a named button", () => {
		const fixed = render(h(MoneyInput, { ...base, value: "" }));
		// Flag and code: the currency's identity on the chip (owner 4G review).
		expect(fixed).toMatch(/<span[^>]*rounded-chip[^>]*>.*ARS<\/span>/);
		expect(fixed).toContain('alt="ARS flag"');
		const open = render(
			h(MoneyInput, { ...base, value: "", onCurrencyChange: vi.fn() }),
		);
		expect(open).toContain('aria-label="Currency, ARS"');
		expect(open).toContain('aria-haspopup="dialog"');
	});

	it("shows the error after a Save attempt", () => {
		const html = render(
			h(MoneyInput, { ...base, value: "12+", showErrors: true }),
		);
		expect(html).toContain("Finish the calculation");
		expect(html).toContain('aria-invalid="true"');
	});

	it("an expression shows its result; a foreign amount keeps its rates and home amount in the field", () => {
		const html = render(
			h(MoneyInput, {
				...base,
				value: "1500+2000",
				label: "You spent",
				rates: {
					label: "Rate",
					value: "blue",
					onChange: vi.fn(),
					options: [
						{ value: "official", label: "Official", rate: "ARS 1,450" },
						{ value: "blue", label: "Blue", rate: "ARS 1,468" },
					],
				},
				home: {
					currency: "USD",
					label: "In budget as",
					value: "USD 2.41",
				},
			}),
		).replaceAll("<!-- -->", "");
		// The domain formatter's result: whole ARS shows no cents.
		expect(html).toContain("ARS\u00a03,500");
		expect(html).toContain("You spent");
		// Every type side by side, the picked one pressed.
		expect(html).toMatch(/aria-label="Rate"[^>]*role="group"/);
		expect(html).toMatch(/aria-pressed="true"[^>]*>.*Blue/);
		expect(html).toMatch(/aria-pressed="false"[^>]*>.*Official/);
		// The home row: the home currency's flag, its words and the server's figure.
		expect(html).toContain('alt="USD flag"');
		expect(html).toContain("In budget as");
		expect(html).toContain("USD 2.41");
	});
});
