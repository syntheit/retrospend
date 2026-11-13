import { describe, expect, it } from "vitest";
import {
	syncBookPeriodSchema,
	syncBudgetBookSchema,
	syncBudgetMovementSchema,
	syncEnvelopeCategorySchema,
	syncEnvelopeChangeSchema,
	syncEnvelopeGroupSchema,
	syncEnvelopeSchema,
	syncIncomeRuleRunSchema,
	syncIncomeRuleSchema,
	syncMonthCloseSchema,
	syncPayoffPlanSchema,
	syncWealthTransferSchema,
} from "./book-schemas";

const at = "2026-11-01T00:00:00.000Z";

const book = {
	id: "b1",
	name: "Home",
	isPersonal: true,
	currency: "ARS",
	style: "FLEX",
	fundingSource: "INCOME",
	pausedAt: null,
	weekStartDay: 1,
	monthStartDay: 1,
	timeZone: "America/Argentina/Buenos_Aires",
	timeZoneConfirmed: true,
	startDate: at,
	startMonth: 202611,
	defaultEnvelopeId: "e1",
	startingBalanceExpenseId: null,
	startingMoneyConfirmedAt: null,
	lastOpenedAt: at,
	welcomeBackFrom: null,
	reconciledAt: null,
	planFundFrom: null,
	payFrequency: "EVERY_TWO_WEEKS",
	payAnchor: at,
	createdAt: at,
	updatedAt: at,
};
const group = {
	id: "g1",
	bookId: "b1",
	name: "Needs",
	sortOrder: 1,
	role: "BILLS",
	targetKind: "PERCENT_OF_INCOME",
	targetValue: "30.5",
	mainEnvelopeId: null,
	archivedAt: null,
	createdAt: at,
	updatedAt: at,
};
const envelope = {
	id: "e1",
	bookId: "b1",
	groupId: "g1",
	name: "Rent",
	icon: null,
	color: "emerald",
	kind: "BILL",
	sortOrder: 1,
	targetAmount: "150000.5",
	targetMode: "REFILL",
	targetCadence: "MONTH",
	targetMonthlyAmount: null,
	targetCurrency: "USD",
	targetDueDate: at,
	targetRepeat: "MONTHLY",
	targetStartMonth: 202611,
	targetTemplateId: null,
	targetLiabilityId: null,
	leftoverRule: "SWEEP",
	leftoverSweepToId: "e2",
	wealthAccountId: null,
	wealthDedicated: false,
	archivedAt: null,
	createdAt: at,
	updatedAt: at,
};
const link = {
	id: "l1",
	bookId: "b1",
	envelopeId: "e1",
	categoryId: "c1",
	createdAt: at,
};
const movement = {
	id: "m1",
	bookId: "b1",
	month: 202611,
	fromEnvelopeId: null,
	toEnvelopeId: "e1",
	amount: "75000.25",
	kind: "CARRY_OVERSPEND",
	batchId: null,
	revertsId: null,
	sourceExpenseId: null,
	ruleId: null,
	note: null,
	createdAt: at,
};
const period = {
	id: "p1",
	bookId: "b1",
	fromMonth: 202611,
	startDay: 5,
	rateType: "blue",
	createdAt: at,
};
const close = {
	id: "x1",
	bookId: "b1",
	month: 202610,
	mode: "USER",
	closedAt: at,
	revision: 2,
	summary: { envelopes: [{ id: "e1", left: "10" }] },
	acknowledgedAt: at,
	ackRevision: 1,
	recalc: null,
	lateEntries: 3,
};
const rule = {
	id: "r1",
	bookId: "b1",
	sortOrder: 0,
	name: "Salary",
	matchKind: "TITLE",
	matchValue: null,
	matchTitle: "ACME",
	action: "PERCENT",
	value: "20",
	envelopeId: "e1",
	active: true,
	archivedAt: null,
	createdAt: at,
	updatedAt: at,
};
const run = {
	expenseId: "x9",
	bookId: "b1",
	batchId: null,
	skipped: false,
	record: [],
	fingerprint: "fp",
	createdAt: at,
	updatedAt: at,
};
const plan = {
	id: "pl1",
	bookId: "b1",
	strategy: "CUSTOM",
	extraMonthly: "0",
	customOrder: ["a1", "a2"],
	envelopeId: null,
	createdAt: at,
	updatedAt: at,
};
const wealth = {
	id: "w1",
	bookId: "b1",
	direction: "FROM_WEALTH",
	envelopeId: null,
	transferId: null,
	sourceExpenseId: "x1",
	assetAccountId: null,
	countOnly: false,
	date: at,
	amount: "300.5",
	note: null,
	createdAt: at,
};
const change = {
	id: "c1",
	bookId: "b1",
	kind: "CONFIRM_STARTING_MONEY",
	envelopeId: null,
	previousName: null,
	before: {},
	createdAt: at,
	undoneAt: null,
};

const CASES = [
	["budget book", syncBudgetBookSchema, book],
	["envelope group", syncEnvelopeGroupSchema, group],
	["envelope", syncEnvelopeSchema, envelope],
	["envelope link", syncEnvelopeCategorySchema, link],
	["movement", syncBudgetMovementSchema, movement],
	["period", syncBookPeriodSchema, period],
	["month close", syncMonthCloseSchema, close],
	["income rule", syncIncomeRuleSchema, rule],
	["income rule run", syncIncomeRuleRunSchema, run],
	["payoff plan", syncPayoffPlanSchema, plan],
	["wealth transfer", syncWealthTransferSchema, wealth],
	["envelope change", syncEnvelopeChangeSchema, change],
] as const;

describe("book row schemas", () => {
	it.each(CASES)("round trips a %s", (_name, schema, row) => {
		expect(schema.parse(row)).toEqual(row);
	});

	it("takes decimals as text, never as a number", () => {
		expect(
			syncEnvelopeSchema.safeParse({ ...envelope, targetAmount: 150000.5 })
				.success,
		).toBe(false);
		expect(
			syncBudgetMovementSchema.safeParse({ ...movement, amount: 1 }).success,
		).toBe(false);
		expect(
			syncWealthTransferSchema.safeParse({ ...wealth, amount: "1e3" }).success,
		).toBe(false);
		expect(
			syncPayoffPlanSchema.safeParse({ ...plan, extraMonthly: 5 }).success,
		).toBe(false);
	});

	it("refuses a value outside the stored enums", () => {
		expect(
			syncBudgetBookSchema.safeParse({ ...book, style: "ZEN" }).success,
		).toBe(false);
		expect(
			syncBudgetMovementSchema.safeParse({ ...movement, kind: "GIFT" }).success,
		).toBe(false);
		expect(
			syncEnvelopeChangeSchema.safeParse({ ...change, kind: "DELETE" }).success,
		).toBe(false);
		expect(
			syncWealthTransferSchema.safeParse({ ...wealth, direction: "SIDEWAYS" })
				.success,
		).toBe(false);
	});

	it("needs an ISO instant, not a date", () => {
		expect(
			syncBookPeriodSchema.safeParse({ ...period, createdAt: "2026-11-01" })
				.success,
		).toBe(false);
	});

	it("does not carry the creator, the actors, the undo state or a derived cache", () => {
		const own = [
			"createdById",
			"actorUserId",
			"userId",
			"styleUndo",
			"limitUndo",
			"undo",
			"dirtyFromMonth",
			"checkpoint",
			"legacyMigrationRunId",
			"legacyMigratedAt",
			"legacyNoticeSeenAt",
			"legacyHiddenIds",
		];
		for (const [, schema] of CASES) {
			for (const column of own)
				expect(Object.keys(schema.shape)).not.toContain(column);
		}
	});

	it("keys a rule run by its expense", () => {
		expect(Object.keys(syncIncomeRuleRunSchema.shape)).toContain("expenseId");
		expect(Object.keys(syncIncomeRuleRunSchema.shape)).not.toContain("id");
	});
});
