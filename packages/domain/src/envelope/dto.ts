/**
 * The budget's view DTOs as plain types: what the month view, Owed, plan
 * cost and the payoff projection hand to a client. The server's zod schemas
 * (src/lib/schemas/envelope*.ts) are the wire contract and the domain may not
 * import zod, so these mirror them, and src/lib/schemas/envelope-dto.test.ts
 * holds each one to its schema in both directions: a field added to one and
 * not the other fails the typecheck. Amounts are integer minor units.
 */
import type { MonthKey } from "./types";

export interface MoneyDto {
	minor: number;
	currency: string;
}

export interface MissingRateDto {
	currency: string;
	rateType: string | null;
	date: string;
}

export interface EnvelopeTargetDto {
	kind: "MONTHLY" | "BILL" | "SAVINGS";
	mode: "REFILL" | "SET_ASIDE" | null;
	cadence: "MONTH" | "WEEK" | null;
	amount: MoneyDto | null;
	need: MoneyDto;
	dueDate: string | null;
	monthsLeft: number | null;
	perMonth: MoneyDto | null;
	progress: MoneyDto | null;
	projectedMonth: MonthKey | null;
	totalAtDue: MoneyDto | null;
	paid: boolean;
	foreign: MoneyDto | null;
	incomplete: boolean;
	liabilityId?: string | null;
	debtPaid?: boolean;
}

export interface LeftThisWeekDto {
	amount: MoneyDto;
	perDay: MoneyDto;
	weekIndex: number;
	weeks: number;
	daysLeftInWeek: number;
	resetsOn: string | null;
}

export interface EnvelopeRowDto {
	id: string;
	name: string;
	icon: string | null;
	color: string | null;
	kind: "MONTHLY" | "BILL" | "SAVINGS" | "NONE";
	groupId: string | null;
	isDefault: boolean;
	sortOrder: number;
	categoryIds: string[];
	carryIn: MoneyDto;
	assigned: MoneyDto;
	activity: MoneyDto;
	spent: MoneyDto;
	spentBasis: number | null;
	left: MoneyDto;
	pending: MoneyDto;
	status: "OVERSPENT" | "UNDERFUNDED" | "FUNDED" | "NO_TARGET";
	target: EnvelopeTargetDto | null;
	leftThisWeek: LeftThisWeekDto | null;
}

export interface GroupTotalsDto {
	carryIn: MoneyDto;
	assigned: MoneyDto;
	activity: MoneyDto;
	spent: MoneyDto;
	spentBasis: number | null;
	left: MoneyDto;
	over: MoneyDto;
	limitLeft: MoneyDto | null;
	need: MoneyDto;
	count: number;
}

export interface GroupTargetDto {
	kind: "AMOUNT" | "PERCENT_OF_INCOME";
	amount: MoneyDto | null;
	basisPoints: number | null;
	base: MoneyDto | null;
	baseSource: "THIS_MONTH" | "TYPICAL" | null;
	plannedBp: number | null;
	spentBp: number | null;
	need: MoneyDto;
	mainEnvelopeId: string | null;
	mainExtra: MoneyDto;
	childrenOverBy: MoneyDto;
	incomplete: boolean;
}

export interface EnvelopeGroupDto {
	id: string | null;
	name: string | null;
	role: "BILLS" | "SPENDING" | "SAVINGS" | null;
	sortOrder: number;
	totals: GroupTotalsDto;
	target?: GroupTargetDto | null;
	envelopes: EnvelopeRowDto[];
}

export interface ToAssignDto {
	amount: MoneyDto;
	poolName: "NOT_PLANNED_YET" | "TO_ASSIGN";
	terms: {
		moneyIn: MoneyDto;
		assigned: MoneyDto;
		assignedAhead: MoneyDto;
		overspendTaken: MoneyDto;
		returned: MoneyDto;
		splitsNet: MoneyDto;
		startingMoney: MoneyDto;
	};
}

export interface LeftToSpendDto {
	left: MoneyDto;
	perDay: MoneyDto;
	daysLeft: number;
	carry: MoneyDto;
	assigned: MoneyDto;
	spent: MoneyDto;
	plannedTooMuch: MoneyDto;
	over: MoneyDto;
	billsHeld: MoneyDto;
	billsShort: MoneyDto;
	billsCount: number;
	savings: MoneyDto;
	notPlanned: MoneyDto;
	fasterThanPlanned: boolean;
}

type VerdictActionDto =
	| "FIX_PLAN"
	| "COVER"
	| "PLAN_BILLS"
	| "USE_PLAN"
	| "TAKE_BACK";

export interface VerdictDto {
	style:
		| "LIMITS"
		| "FLEX"
		| "EVERY_DOLLAR"
		| "SAVE_FIRST"
		| "FIFTY_THIRTY_TWENTY"
		| "WEEKLY"
		| "DEBT_PAYOFF";
	month: MonthKey;
	lead: {
		kind: "LEFT_TO_SPEND" | "TO_ASSIGN" | "LEFT_THIS_WEEK" | "LEFT_IN_LIMITS";
		figureId: string;
		amount: MoneyDto;
	};
	state:
		| "PLANNED_TOO_MUCH"
		| "OVER_BUDGET"
		| "BILLS_SHORT"
		| "USED_UP"
		| "FASTER_THAN_PLANNED"
		| "SOME_OVER"
		| "ON_TRACK"
		| "ALL_ASSIGNED"
		| "NEEDS_JOB"
		| "OVER_ASSIGNED"
		| "WEEK_LEFT"
		| "WEEK_USED";
	perDay: MoneyDto;
	daysLeft: number;
	over: MoneyDto;
	overEnvelopes: Array<{ id: string; over: MoneyDto }>;
	billsShort: MoneyDto;
	plannedTooMuch: MoneyDto;
	resetsOn: string | null;
	action: VerdictActionDto | null;
	notice: {
		kind: "NOT_PLANNED_YET" | "OVERSPENT";
		amount: MoneyDto;
		action: VerdictActionDto;
	} | null;
	poolName: "NOT_PLANNED_YET" | "TO_ASSIGN";
	limits: { limit: MoneyDto; spent: MoneyDto } | null;
	incomplete: boolean;
}

/** The Owed line on the Budget page. */
export interface OwedSummaryDto {
	held: MoneyDto;
	pending: MoneyDto;
	people: number;
	aging: number;
}

export interface OwedLineDto {
	amount: MoneyDto;
	held: MoneyDto;
	oldestOpen: string | null;
	ageDays: number | null;
}

export interface OwedPersonDto {
	participant: { type: "user" | "guest" | "shadow"; id: string };
	name: string | null;
	lines: OwedLineDto[];
	held: MoneyDto;
	pending: MoneyDto;
	lastPaidOn: string | null;
	ageDays: number | null;
	aging: boolean;
}

export interface OwedDto {
	held: MoneyDto;
	pending: MoneyDto;
	people: OwedPersonDto[];
	notInBudget: Array<{ projectId: string; name: string }>;
	incomplete: boolean;
}

/** getMonth: the month view. */
export interface MonthViewDto {
	book: {
		id: string;
		style: VerdictDto["style"];
		fundingSource: "INCOME" | "TARGETS";
		currency: string;
		startMonth: MonthKey;
		weekStartDay: number;
		defaultEnvelopeId: string;
		paused: boolean;
	};
	month: {
		key: MonthKey;
		from: string;
		to: string;
		state: "CLOSED" | "OPEN" | "NEXT";
	};
	today: string;
	toAssign: ToAssignDto;
	groups: EnvelopeGroupDto[];
	leftToSpend: LeftToSpendDto;
	verdict: VerdictDto;
	owed: OwedSummaryDto;
	shares: { unresolved: number; pending: MoneyDto };
	incomplete: boolean;
	approximate: boolean;
	missingRates: MissingRateDto[];
}

export interface PlanCostDto {
	month: MonthKey;
	cost: MoneyDto;
	byGroup: Array<{ groupId: string | null; cost: MoneyDto }>;
	typicalIncome: MoneyDto | null;
	closedMonths: number;
	essentialCost: MoneyDto;
	essentialIds: string[];
	runway: { available: MoneyDto; tenths: number } | null;
	incomplete: boolean;
}

export interface PayoffPlanDto {
	strategy: "SNOWBALL" | "AVALANCHE" | "CUSTOM";
	extraMonthly: MoneyDto;
	customOrder: string[];
	envelopeId: string | null;
}

export interface PayoffDebtDto {
	assetAccountId: string;
	balance: MoneyDto;
	aprPercent: string;
	minimum: MoneyDto;
	dueDay: number | null;
	payoffMonth: MonthKey | null;
	interest: MoneyDto;
	nextMinimum: MoneyDto;
	nextExtra: MoneyDto;
}

export interface PayoffProjection {
	plan: PayoffPlanDto;
	debtFreeMonth: MonthKey | null;
	months: number;
	capped: boolean;
	diverges: boolean;
	totalDebt: MoneyDto;
	totalInterest: MoneyDto;
	debts: PayoffDebtDto[];
	schedule: Array<{ month: MonthKey; balances: number[] }>;
	missingRates: Array<{ assetAccountId: string; currency: string }>;
	incomplete: boolean;
}
