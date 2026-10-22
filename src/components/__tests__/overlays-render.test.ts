// Server-rendered markup of the S1b components: names, roving focus and
// identity without a DOM (vitest runs in node here).
import { NextIntlClientProvider } from "next-intl";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../../../packages/i18n/src/load";
import { ActionMenu } from "../actions/action-menu";
import { MoneyInput, type MoneyInputParser } from "../money/money-input";
import { CategoryPicker } from "../pickers/category-picker";
import { MonthGrid } from "../pickers/month-grid";
import { PersonPicker } from "../pickers/person-picker";

const messages = await loadCatalog("en");
const render = (el: ReactElement) =>
	renderToStaticMarkup(
		h(NextIntlClientProvider, { locale: "en", messages, timeZone: "UTC", children: el }),
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
	const parser: MoneyInputParser = {
		parseMoneyInput: (text) =>
			text === "12+"
				? { ok: false, error: "incomplete" }
				: text.includes("+")
					? { ok: true, minor: 350000, expression: true }
					: { ok: true, minor: 120000, expression: false },
		formatMoneyDraft: (t) => t,
		decimalSeparator: () => ".",
		groupSeparator: () => ",",
		formatMoney: (m) => `ARS ${m.minor}`,
	};
	const base = { parser, currency: "ARS", onChange: vi.fn() };

	it("a decimal keypad, a named amount and currency, no error while typing", () => {
		const html = render(h(MoneyInput, { ...base, value: "12+" }));
		expect(html).toContain('inputMode="decimal"');
		expect(html).toContain('aria-label="Amount"');
		expect(html).toContain('aria-label="Currency, ARS"');
		expect(html).not.toContain('role="alert"');
	});

	it("shows the error after a Save attempt", () => {
		const html = render(
			h(MoneyInput, { ...base, value: "12+", showErrors: true }),
		);
		expect(html).toContain("Finish the calculation");
		expect(html).toContain('aria-invalid="true"');
	});

	it("an expression shows its result; the rate chip names the rate", () => {
		const html = render(
			h(MoneyInput, {
				...base,
				value: "1500+2000",
				rate: { label: "USD 1 = ARS 1,468 · Blue" },
			}),
		);
		expect(html).toContain("ARS 350000");
		expect(html).toContain(
			'aria-label="Exchange rate: USD 1 = ARS 1,468 · Blue"',
		);
	});
});
