import { describe, expect, it } from "vitest";
import { Prisma, type RecurringTemplate } from "~prisma";
import { type StoredTarget, targetOf } from "./target-input";
import { bookContext } from "./test-fixtures";

const stored = (over: Partial<StoredTarget>): StoredTarget => ({
	kind: "MONTHLY",
	targetAmount: null,
	targetMode: "REFILL",
	targetCadence: "MONTH",
	targetMonthlyAmount: null,
	targetCurrency: null,
	targetDueDate: null,
	targetRepeat: null,
	targetTemplateId: null,
	...over,
});

const template = (over: Partial<RecurringTemplate>) =>
	({
		id: "t1",
		amount: new Prisma.Decimal("41500"),
		currency: "ARS",
		frequency: "MONTHLY",
		nextDueDate: new Date("2027-01-10T03:00:00Z"),
		...over,
	}) as RecurringTemplate;

function ctx(templates: RecurringTemplate[] = []) {
	return {
		valuation: bookContext("ARS", { defaultRateType: "blue" }),
		today: "2026-10-10",
		month: 202610,
		tz: "America/Argentina/Buenos_Aires",
		periods: [{ fromMonth: 202601, startDay: 1 }],
		templates: new Map(templates.map((t) => [t.id, t])),
		missingRates: [],
	};
}

describe("stored targets to engine targets (D25, D26)", () => {
	it("a monthly target in the book currency, in minor units", () => {
		expect(
			targetOf(stored({ targetAmount: new Prisma.Decimal("180000") }), ctx())
				.target,
		).toEqual({
			kind: "MONTHLY",
			amount: 18_000_000,
			mode: "REFILL",
			cadence: "MONTH",
		});
	});

	it("S10 a USD goal in an ARS book converts at today's blue rate and keeps the USD amount", () => {
		const out = targetOf(
			stored({
				kind: "SAVINGS",
				targetAmount: new Prisma.Decimal("2000"),
				targetCurrency: "USD",
				targetDueDate: new Date("2027-01-05T00:00:00Z"),
			}),
			ctx(),
		);
		expect(out).toEqual({
			target: {
				kind: "SAVINGS",
				amount: 293_000_000,
				dueMonth: 202701,
				monthly: null,
			},
			foreign: { minor: 200_000, currency: "USD" },
			targetIncomplete: false,
		});
	});

	it("C18 a goal in a currency with no rate is flagged, never valued at 1", () => {
		const c = ctx();
		const out = targetOf(
			stored({
				kind: "SAVINGS",
				targetAmount: new Prisma.Decimal("500000"),
				targetCurrency: "CLP",
			}),
			c,
		);
		expect(out).toMatchObject({ target: null, targetIncomplete: true });
		expect(c.missingRates).toHaveLength(1);
	});

	it("S8 a bill that follows a template takes its amount and due date in the book zone", () => {
		const out = targetOf(
			stored({ kind: "BILL", targetTemplateId: "t1" }),
			ctx([template({})]),
		);
		expect(out.target).toEqual({
			kind: "BILL",
			amount: 4_150_000,
			dueDate: "2027-01-10",
			repeatMonths: 1,
			linkedToTemplate: true,
		});
	});

	it("a weekly template cannot drive a bill target", () => {
		expect(
			targetOf(
				stored({ kind: "BILL", targetTemplateId: "t1" }),
				ctx([template({ frequency: "WEEKLY" })]),
			).target,
		).toBeNull();
	});

	it("a fixed bill repeats by its frequency in months", () => {
		const out = targetOf(
			stored({
				kind: "BILL",
				targetAmount: new Prisma.Decimal("1200"),
				targetDueDate: new Date("2027-05-15T00:00:00Z"),
				targetRepeat: "YEARLY",
			}),
			ctx(),
		);
		expect(out.target).toMatchObject({
			dueDate: "2027-05-15",
			repeatMonths: 12,
		});
	});
});
