/**
 * The template rules. Expected instants are derived by hand from the zones'
 * offsets: Buenos Aires is UTC-3 all year, Tokyo UTC+9 all year, New York
 * UTC-5 in winter and UTC-4 in summer (DST began Sunday 2026-03-08 and ends
 * Sunday 2026-11-01).
 */
import { describe, expect, it } from "vitest";
import { CategoryNotFoundError } from "../expense-write/refusals";
import { RecurringInputRefusal } from "./refusals";
import {
	anchorOf,
	checkTemplateCategory,
	dueInstant,
	editPatch,
	newTemplateDirection,
	newTemplateRow,
	resolveAnchor,
	type TemplateInput,
	templateCategoryKind,
} from "./template";
import { at, BA, TOKYO } from "./test-kit";

const NEW_YORK = "America/New_York";

const refusal = (kind: string) =>
	expect.objectContaining({ constructor: RecurringInputRefusal, kind });

describe("anchorOf", () => {
	it("is the day of month typed", () => {
		expect(anchorOf("2026-12-31")).toBe(31);
		expect(anchorOf("2027-02-01")).toBe(1);
		expect(anchorOf("2028-02-29")).toBe(29);
	});
});

describe("dueInstant", () => {
	it("an expense day is the start of that day in the saved zone", () => {
		expect(dueInstant("2026-12-01", "OUT", BA)).toEqual(
			at("2026-12-01T03:00:00.000Z"),
		);
		// Dec 1 00:00 in Tokyo is Nov 30 15:00Z.
		expect(dueInstant("2026-12-01", "OUT", TOKYO)).toEqual(
			at("2026-11-30T15:00:00.000Z"),
		);
		expect(dueInstant("2026-12-01", "OUT", "UTC")).toEqual(
			at("2026-12-01T00:00:00.000Z"),
		);
	});

	it("a zone change moves the instant of the same typed day", () => {
		const before = dueInstant("2026-12-01", "OUT", BA);
		const after = dueInstant("2026-12-01", "OUT", TOKYO);
		expect(before.getTime() - after.getTime()).toBe(12 * 3_600_000);
	});

	it("income keeps its day as UTC midnight in every zone", () => {
		for (const zone of [BA, TOKYO, NEW_YORK])
			expect(dueInstant("2026-12-01", "IN", zone)).toEqual(
				at("2026-12-01T00:00:00.000Z"),
			);
	});

	it("a zone without DST gives the same offset on both sides of a US change", () => {
		expect(dueInstant("2026-03-08", "OUT", BA)).toEqual(
			at("2026-03-08T03:00:00.000Z"),
		);
		expect(dueInstant("2026-03-09", "OUT", BA)).toEqual(
			at("2026-03-09T03:00:00.000Z"),
		);
	});

	it("a DST zone takes the offset in force at the start of that day", () => {
		// Mar 8 00:00 is still EST (UTC-5); the clocks jump at 02:00, so Mar 9
		// starts in EDT (UTC-4).
		expect(dueInstant("2026-03-08", "OUT", NEW_YORK)).toEqual(
			at("2026-03-08T05:00:00.000Z"),
		);
		expect(dueInstant("2026-03-09", "OUT", NEW_YORK)).toEqual(
			at("2026-03-09T04:00:00.000Z"),
		);
		// Nov 1 00:00 is still EDT (the clocks fall at 02:00); Nov 2 starts in EST.
		expect(dueInstant("2026-11-01", "OUT", NEW_YORK)).toEqual(
			at("2026-11-01T04:00:00.000Z"),
		);
		expect(dueInstant("2026-11-02", "OUT", NEW_YORK)).toEqual(
			at("2026-11-02T05:00:00.000Z"),
		);
	});

	it("refuses a day that is not YYYY-MM-DD", () => {
		expect(() => dueInstant("12/01/2026", "OUT", BA)).toThrow(
			"Date must be in YYYY-MM-DD format",
		);
	});
});

describe("checkTemplateCategory", () => {
	it("an expense template needs an expense category", () => {
		expect(templateCategoryKind("OUT")).toBe("EXPENSE");
		expect(() =>
			checkTemplateCategory({ kind: "EXPENSE" }, "OUT"),
		).not.toThrow();
		expect(() => checkTemplateCategory({ kind: "INCOME" }, "OUT")).toThrow(
			CategoryNotFoundError,
		);
	});

	it("an income template needs an income category", () => {
		expect(templateCategoryKind("IN")).toBe("INCOME");
		expect(() => checkTemplateCategory({ kind: "INCOME" }, "IN")).not.toThrow();
		expect(() => checkTemplateCategory({ kind: "EXPENSE" }, "IN")).toThrow(
			CategoryNotFoundError,
		);
	});

	it("a category that was not found is refused", () => {
		expect(() => checkTemplateCategory(null, "OUT")).toThrow(
			CategoryNotFoundError,
		);
		expect(() => checkTemplateCategory(undefined, "IN")).toThrow(
			CategoryNotFoundError,
		);
	});

	it("answers like every other bad category on a template: forbidden, Category not found", () => {
		expect(() => checkTemplateCategory(null, "OUT")).toThrowError(
			expect.objectContaining({
				v1Code: "forbidden",
				message: "Category not found",
			}),
		);
	});
});

describe("resolveAnchor", () => {
	const monthly = (nextDueDate: string, anchorDay?: number) =>
		resolveAnchor({ nextDueDate, frequency: "MONTHLY", anchorDay });

	it("without an anchorDay it is the day typed, which is 28 when 31 was clamped", () => {
		expect(monthly("2026-12-31")).toBe(31);
		expect(monthly("2027-02-28")).toBe(28);
	});

	it("an anchor of 31 survives a first date clamped to the last day of a short month", () => {
		expect(monthly("2027-02-28", 31)).toBe(31);
		// 2028 is a leap year: February has 29 days.
		expect(monthly("2028-02-29", 31)).toBe(31);
		expect(monthly("2026-04-30", 31)).toBe(31);
		expect(monthly("2027-02-28", 30)).toBe(30);
		expect(monthly("2027-01-31", 31)).toBe(31);
	});

	it("the first date must be the anchor, or the last day of a month too short for it", () => {
		// Feb 28 is not the last day of February in a leap year.
		expect(() => monthly("2028-02-28", 31)).toThrowError(
			refusal("anchor_mismatch"),
		);
		expect(() => monthly("2026-04-29", 31)).toThrowError(
			refusal("anchor_mismatch"),
		);
		expect(() => monthly("2026-01-16", 15)).toThrowError(
			refusal("anchor_mismatch"),
		);
		expect(() => monthly("2026-01-16", 15)).toThrow(
			"nextDueDate must fall on anchorDay",
		);
	});

	it("an anchor outside 1 to 31, or not a whole number, is refused", () => {
		// 32 on a Jan 31 first date: min(32, 31) is the typed day, so only the
		// range check refuses it.
		expect(() => monthly("2026-01-31", 32)).toThrowError(
			refusal("anchor_out_of_range"),
		);
		expect(() => monthly("2026-01-31", 32)).toThrow(
			"anchorDay must be 1 to 31",
		);
		expect(() => monthly("2026-01-01", 0)).toThrowError(
			refusal("anchor_out_of_range"),
		);
		expect(() => monthly("2026-01-15", 15.5)).toThrowError(
			refusal("anchor_out_of_range"),
		);
	});

	it("quarterly and yearly keep an anchor like monthly", () => {
		for (const frequency of ["QUARTERLY", "YEARLY"] as const) {
			expect(
				resolveAnchor({ nextDueDate: "2027-02-28", frequency, anchorDay: 31 }),
			).toBe(31);
			expect(() =>
				resolveAnchor({ nextDueDate: "2028-02-28", frequency, anchorDay: 31 }),
			).toThrowError(refusal("anchor_mismatch"));
		}
	});

	it("weekly and biweekly ignore an anchorDay, even one that would be refused", () => {
		for (const frequency of ["WEEKLY", "BIWEEKLY"] as const) {
			expect(
				resolveAnchor({ nextDueDate: "2026-12-09", frequency, anchorDay: 99 }),
			).toBe(9);
			expect(
				resolveAnchor({ nextDueDate: "2026-12-09", frequency, anchorDay: 31 }),
			).toBe(9);
		}
	});
});

describe("newTemplateRow", () => {
	const base: TemplateInput = {
		name: "Netflix",
		amount: "20.00",
		currency: "USD",
		frequency: "MONTHLY",
		nextDueDate: "2026-12-01",
	};

	it("starts out as an expense with a fixed amount, paying automatically", () => {
		expect(newTemplateDirection(base)).toBe("OUT");
		expect(newTemplateRow(base, BA)).toStrictEqual({
			name: "Netflix",
			amount: "20.00",
			currency: "USD",
			categoryId: undefined,
			direction: "OUT",
			amountMode: "FIXED",
			frequency: "MONTHLY",
			nextDueDate: at("2026-12-01T03:00:00.000Z"),
			anchorDay: 1,
			websiteUrl: undefined,
			paymentSource: undefined,
			autoPay: true,
		});
	});

	it("keeps what the input says, including auto-pay off and an ask amount", () => {
		const row = newTemplateRow(
			{
				...base,
				categoryId: "c1",
				amountMode: "ASK",
				autoPay: false,
				websiteUrl: "https://example.com",
				paymentSource: "Visa",
			},
			TOKYO,
		);
		expect(row).toMatchObject({
			categoryId: "c1",
			amountMode: "ASK",
			autoPay: false,
			websiteUrl: "https://example.com",
			paymentSource: "Visa",
			// Dec 1 00:00 in Tokyo.
			nextDueDate: at("2026-11-30T15:00:00.000Z"),
		});
	});

	it("an income template is due at UTC midnight whatever the zone", () => {
		const row = newTemplateRow({ ...base, direction: "IN" }, BA);
		expect(row.direction).toBe("IN");
		expect(row.nextDueDate).toEqual(at("2026-12-01T00:00:00.000Z"));
	});

	it("a clamped first date keeps the anchor asked for", () => {
		const row = newTemplateRow(
			{ ...base, nextDueDate: "2027-02-28", anchorDay: 31 },
			BA,
		);
		expect(row.anchorDay).toBe(31);
		expect(row.nextDueDate).toEqual(at("2027-02-28T03:00:00.000Z"));
	});

	it("refuses an anchor the first date does not fall on", () => {
		expect(() =>
			newTemplateRow({ ...base, nextDueDate: "2026-01-16", anchorDay: 15 }, BA),
		).toThrowError(refusal("anchor_mismatch"));
	});
});

describe("editPatch", () => {
	it("an edit that names nothing changes nothing", () => {
		expect(editPatch({}, "OUT", BA)).toStrictEqual({});
	});

	it("carries only the fields named, with false and null as real values", () => {
		expect(
			editPatch(
				{
					name: "Gym",
					amount: "35.50",
					currency: "ARS",
					categoryId: null,
					amountMode: "ASK",
					websiteUrl: null,
					paymentSource: "Cash",
					autoPay: false,
					isActive: false,
				},
				"OUT",
				BA,
			),
		).toStrictEqual({
			name: "Gym",
			amount: "35.50",
			currency: "ARS",
			categoryId: null,
			amountMode: "ASK",
			websiteUrl: null,
			paymentSource: "Cash",
			autoPay: false,
			isActive: false,
		});
	});

	it("a due date sets the due instant and makes its day the anchor", () => {
		expect(editPatch({ nextDueDate: "2026-12-15" }, "OUT", BA)).toStrictEqual({
			nextDueDate: at("2026-12-15T03:00:00.000Z"),
			anchorDay: 15,
		});
	});

	it("a due date on a clamped month-end makes that day the anchor, not 31", () => {
		expect(editPatch({ nextDueDate: "2027-02-28" }, "OUT", BA)).toMatchObject({
			anchorDay: 28,
		});
	});

	it("the frequency alone moves neither the due date nor the anchor", () => {
		expect(editPatch({ frequency: "WEEKLY" }, "OUT", BA)).toStrictEqual({
			frequency: "WEEKLY",
		});
	});

	it("a frequency with a due date moves both, as the day typed", () => {
		expect(
			editPatch({ frequency: "YEARLY", nextDueDate: "2028-02-29" }, "OUT", BA),
		).toStrictEqual({
			frequency: "YEARLY",
			nextDueDate: at("2028-02-29T03:00:00.000Z"),
			anchorDay: 29,
		});
	});

	it("an empty due date is no due date", () => {
		expect(editPatch({ nextDueDate: "" }, "OUT", BA)).toStrictEqual({});
	});

	it("reads the due date in the saved zone and an income one as UTC", () => {
		expect(
			editPatch({ nextDueDate: "2026-12-01" }, "OUT", TOKYO),
		).toMatchObject({ nextDueDate: at("2026-11-30T15:00:00.000Z") });
		expect(editPatch({ nextDueDate: "2026-12-01" }, "IN", TOKYO)).toMatchObject(
			{ nextDueDate: at("2026-12-01T00:00:00.000Z") },
		);
	});

	it("a DST zone and a zone without it differ on the day the clocks change", () => {
		expect(
			editPatch({ nextDueDate: "2026-03-08" }, "OUT", NEW_YORK).nextDueDate,
		).toEqual(at("2026-03-08T05:00:00.000Z"));
		expect(
			editPatch({ nextDueDate: "2026-03-08" }, "OUT", BA).nextDueDate,
		).toEqual(at("2026-03-08T03:00:00.000Z"));
	});
});
