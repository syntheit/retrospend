/**
 * The JS twin of the budget row filters (domain envelope/budget-rows.ts)
 * against the Prisma filters the server runs (services/spending.ts,
 * envelope/inputs-source.ts), on one generated ledger. A device applies the
 * twin to the rows it holds, so the two must pick the same rows, to the row.
 *
 * The ledger is the full cross product of: status x (direction, entry kind,
 * income type: the nine the table's CHECK allows) x keepInWealth x
 * excludeFromAnalytics x amortization (parent flag x child flag x its own
 * amortize mode x parent: none, missing, INSTALLMENTS, REPORTS_ONLY) x category
 * (none, EXPENSE, INCOME) x six dates around the two window edges: the
 * spending window opens at FROM, the closed months' income window is
 * [FROM, TO). A "missing" parent is another person's expense, which row-level
 * security hides from the person's query, as a parent not yet synced is hidden
 * from a device.
 *
 * Both sides read the person's rows only. For each of the four rules the sets
 * must be equal, every reason a row can be out and every branch that lets one
 * in must occur, and a few rows are checked by hand against what the filters
 * are meant to do, so the test does not only compare two readings of one rule.
 *
 * Null category: `NOT { category: { is: { kind: INCOME } } }` keeps a row with
 * no category in Postgres (Prisma writes the negation null-safe), so an
 * uncategorized expense counts as spending and a refund. The twin matches.
 */
import { randomUUID } from "node:crypto";
import {
	amortizationBranch,
	type BudgetRowFields,
	isBudgetMoneyIn,
	isBudgetRefund,
	isBudgetSpending,
	isClosedIncome,
	moneyInBranch,
	type ParentOf,
	whyNotClosedIncome,
	whyNotMoneyIn,
	whyNotRefund,
	whyNotSpending,
} from "@retrospend/domain/envelope/budget-rows";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { budgetClosedIncomeWhere } from "../spending";
import { prismaBudgetInputs } from "./inputs-source";

const SEED_MS = 240_000;
vi.setConfig({ testTimeout: SEED_MS, hookTimeout: SEED_MS });

const FROM = new Date("2026-03-01T03:00:00.000Z");
const TO = new Date("2026-04-01T03:00:00.000Z");
const MS = 1;
const DATES = [
	new Date(FROM.getTime() - MS),
	FROM,
	new Date(FROM.getTime() + MS),
	new Date(TO.getTime() - MS),
	TO,
	new Date(TO.getTime() + MS),
];

type Direction = "OUT" | "IN";
type Kind = "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
type InType = "INCOME" | "REFUND" | null;
type ParentRef = "NONE" | "MISSING" | "INSTALLMENTS" | "REPORTS_ONLY";
type CategoryOf = "NONE" | "EXPENSE" | "INCOME";

/** The (direction, entry kind, income type) triples expense_in_type_check allows. */
const SHAPES: ReadonlyArray<readonly [Direction, Kind, InType]> = [
	...(
		["STANDARD", "STARTING_BALANCE", "ADJUSTMENT", "NOT_SPENDING"] as const
	).map((k) => ["OUT", k, null] as const),
	["IN", "STANDARD", "INCOME"],
	["IN", "STANDARD", "REFUND"],
	["IN", "STARTING_BALANCE", null],
	["IN", "ADJUSTMENT", null],
	["IN", "NOT_SPENDING", null],
];

interface Spec {
	status: "DRAFT" | "FINALIZED";
	direction: Direction;
	entryKind: Kind;
	inType: InType;
	keepInWealth: boolean;
	hidden: boolean;
	parent: boolean;
	child: boolean;
	mode: "INSTALLMENTS" | "REPORTS_ONLY";
	parentRef: ParentRef;
	category: CategoryOf;
	date: Date;
}

function* cross(): Generator<Spec> {
	for (const status of ["DRAFT", "FINALIZED"] as const)
		for (const [direction, entryKind, inType] of SHAPES)
			for (const keepInWealth of [false, true])
				for (const hidden of [false, true])
					for (const parent of [false, true])
						for (const child of [false, true])
							for (const mode of ["INSTALLMENTS", "REPORTS_ONLY"] as const)
								for (const parentRef of [
									"NONE",
									"MISSING",
									"INSTALLMENTS",
									"REPORTS_ONLY",
								] as const)
									for (const category of ["NONE", "EXPENSE", "INCOME"] as const)
										for (const date of DATES)
											yield {
												status,
												direction,
												entryKind,
												inType,
												keepInWealth,
												hidden,
												parent,
												child,
												mode,
												parentRef,
												category,
												date,
											};
}

/** The plain row every hand check starts from: it counts as spending at FROM. */
const BASE: Spec = {
	status: "FINALIZED",
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	keepInWealth: false,
	hidden: false,
	parent: false,
	child: false,
	mode: "INSTALLMENTS",
	parentRef: "NONE",
	category: "EXPENSE",
	date: FROM,
};

interface Row extends BudgetRowFields {
	id: string;
	spec: Spec | null;
}

const D = (v: string | number) => new Prisma.Decimal(v);

let userId: string;
const ids = {} as Record<
	| "expenseCategory"
	| "incomeCategory"
	| "installmentsParent"
	| "reportsParent"
	| "foreignParent",
	string
>;
let rows: Row[];
const specIds = new Map<string, Row>();

let spending: Set<string>;
let refunds: Set<string>;
let moneyIn: Set<string>;
let closedIncome: Set<string>;

const parentOf: ParentOf = (id) => {
	const parent = rows.find((r) => r.id === id);
	return parent ? { amortizeMode: parent.amortizeMode } : undefined;
};

const key = (s: Spec) => JSON.stringify({ ...s, date: s.date.toISOString() });

function expenseData(
	owner: string,
	id: string,
	s: Spec,
	parentId: string | null,
	categoryId: string | null,
) {
	return {
		id,
		userId: owner,
		title: "row",
		amount: D(10),
		currency: "ARS",
		date: s.date,
		categoryId,
		amountInUSD: D(1),
		exchangeRate: D(1500),
		pricingSource: "MANUAL",
		status: s.status,
		isAmortizedParent: s.parent,
		isAmortizedChild: s.child,
		parentId,
		excludeFromAnalytics: s.hidden,
		direction: s.direction,
		entryKind: s.entryKind,
		inType: s.inType,
		amortizeMode: s.mode,
		keepInWealth: s.keepInWealth,
	};
}

beforeAll(async () => {
	const { user } = await createTestUser();
	const { user: other } = await createTestUser();
	userId = user.id;
	const categoryOf = async (name: string, kind: "EXPENSE" | "INCOME") =>
		(
			await fixtureDb.category.create({
				data: { userId, name, color: "blue", kind },
			})
		).id;
	ids.expenseCategory = await categoryOf("Food", "EXPENSE");
	ids.incomeCategory = await categoryOf("Salary", "INCOME");
	ids.installmentsParent = randomUUID();
	ids.reportsParent = randomUUID();
	ids.foreignParent = randomUUID();

	const parentSpec = (mode: Spec["mode"]): Spec => ({
		...BASE,
		parent: true,
		mode,
		date: DATES[2] as Date,
	});
	const installments = parentSpec("INSTALLMENTS");
	const reports = parentSpec("REPORTS_ONLY");
	await fixtureDb.expense.createMany({
		data: [
			expenseData(userId, ids.installmentsParent, installments, null, null),
			expenseData(userId, ids.reportsParent, reports, null, null),
			expenseData(other.id, ids.foreignParent, installments, null, null),
		],
	});

	const parentId = (r: ParentRef) =>
		({
			NONE: null,
			MISSING: ids.foreignParent,
			INSTALLMENTS: ids.installmentsParent,
			REPORTS_ONLY: ids.reportsParent,
		})[r];
	const categoryId = (c: CategoryOf) =>
		({ NONE: null, EXPENSE: ids.expenseCategory, INCOME: ids.incomeCategory })[
			c
		];
	const kindOf = (c: CategoryOf) => (c === "NONE" ? null : c);

	rows = [
		{ id: ids.installmentsParent, spec: installments },
		{ id: ids.reportsParent, spec: reports },
	].map(({ id, spec }) => ({
		id,
		spec,
		status: spec.status,
		direction: spec.direction,
		entryKind: spec.entryKind,
		inType: spec.inType,
		keepInWealth: spec.keepInWealth,
		isAmortizedParent: spec.parent,
		isAmortizedChild: spec.child,
		parentId: null,
		amortizeMode: spec.mode,
		categoryKind: null,
		date: spec.date,
	}));
	const data: ReturnType<typeof expenseData>[] = [];
	for (const s of cross()) {
		const id = randomUUID();
		data.push(
			expenseData(userId, id, s, parentId(s.parentRef), categoryId(s.category)),
		);
		const row: Row = {
			id,
			spec: s,
			status: s.status,
			direction: s.direction,
			entryKind: s.entryKind,
			inType: s.inType,
			keepInWealth: s.keepInWealth,
			isAmortizedParent: s.parent,
			isAmortizedChild: s.child,
			parentId: parentId(s.parentRef),
			amortizeMode: s.mode,
			categoryKind: kindOf(s.category),
			date: s.date,
		};
		rows.push(row);
		specIds.set(key(s), row);
	}
	for (let i = 0; i < data.length; i += 2000)
		await fixtureDb.expense.createMany({ data: data.slice(i, i + 2000) });

	// About 41,000 rows are read three times; Prisma's 5 s default for an
	// interactive transaction is too short when the gate runs files in parallel.
	const own = await userTransaction(
		adminDb,
		userId,
		async (tx) => {
			const read = await prismaBudgetInputs(tx, userId, "no-book").ownRows({
				from: FROM,
				afterMonth: 0,
			});
			const closed = await tx.expense.findMany({
				where: budgetClosedIncomeWhere(userId, FROM, TO),
				select: { id: true },
			});
			return { read, closed };
		},
		{ timeout: 120_000 },
	);
	const set = (list: { id: string }[]) => new Set(list.map((r) => r.id));
	spending = set(own.read.spending);
	refunds = set(own.read.refunds);
	moneyIn = set(own.read.moneyIn);
	closedIncome = set(own.closed);
}, SEED_MS);

const sortedIds = (list: Iterable<string>) => [...list].sort();
const of = (s: Partial<Spec>): string => {
	const row = specIds.get(key({ ...BASE, ...s }));
	if (!row) throw new Error(`no generated row for ${JSON.stringify(s)}`);
	return row.id;
};

describe("budget row filters, twin and Prisma", () => {
	it("holds every id of the cross product, once", () => {
		// 2 statuses x 9 shapes x 2 x 2 x (2 x 2 x 2 x 4) x 3 categories x 6 dates,
		// plus the person's two parent rows.
		expect(rows).toHaveLength(2 * 9 * 2 * 2 * 32 * 3 * 6 + 2);
		expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
	});

	const rules = [
		{
			name: "spending",
			pg: () => spending,
			twin: (r: Row) => isBudgetSpending(r, parentOf, FROM),
			why: (r: Row) => whyNotSpending(r, parentOf, FROM),
			reasons: [
				"NOT_FINALIZED",
				"NOT_OUT",
				"NOT_STANDARD",
				"BEFORE_FROM",
				"AMORTIZATION",
				"INCOME_CATEGORY",
			],
		},
		{
			name: "refunds",
			pg: () => refunds,
			twin: (r: Row) => isBudgetRefund(r, FROM),
			why: (r: Row) => whyNotRefund(r, FROM),
			reasons: [
				"NOT_FINALIZED",
				"NOT_IN",
				"NOT_STANDARD",
				"NOT_REFUND",
				"BEFORE_FROM",
				"INCOME_CATEGORY",
			],
		},
		{
			name: "money in",
			pg: () => moneyIn,
			twin: (r: Row) => isBudgetMoneyIn(r, FROM),
			why: (r: Row) => whyNotMoneyIn(r, FROM),
			reasons: [
				"NOT_FINALIZED",
				"BEFORE_FROM",
				"KEPT_IN_WEALTH",
				"NOT_MONEY_IN",
			],
		},
		{
			name: "closed months' income",
			pg: () => closedIncome,
			twin: (r: Row) => isClosedIncome(r, FROM, TO),
			why: (r: Row) => whyNotClosedIncome(r, FROM, TO),
			reasons: [
				"NOT_FINALIZED",
				"NOT_STANDARD",
				"BEFORE_FROM",
				"FROM_TO",
				"KEPT_IN_WEALTH",
				"NOT_MONEY_IN",
			],
		},
	];

	for (const rule of rules) {
		it(`${rule.name}: the twin picks the rows Prisma picks`, () => {
			const twin = rows.filter(rule.twin).map((r) => r.id);
			const pg = rule.pg();
			expect(twin.length).toBeGreaterThan(0);
			expect(twin.length).toBeLessThan(rows.length);
			const missing = sortedIds(pg).filter((id) => !twin.includes(id));
			const extra = twin.filter((id) => !pg.has(id));
			expect(
				{ missing: missing.length, extra: extra.length },
				`twin lacks ${missing.length}, adds ${extra.length}; first: ${JSON.stringify(
					rows.find((r) => missing.includes(r.id) || extra.includes(r.id))
						?.spec,
				)}`,
			).toEqual({ missing: 0, extra: 0 });
			expect(sortedIds(twin)).toEqual(sortedIds(pg));
		});

		it(`${rule.name}: every reason a row is out occurs`, () => {
			const seen = new Set(rows.map(rule.why).filter((w) => w !== null));
			expect(sortedIds(seen as Set<string>)).toEqual(sortedIds(rule.reasons));
		});
	}

	it("spending: every amortization branch that counts a row occurs, and the one that does not", () => {
		const branches = new Set(
			rows
				.filter((r) => r.categoryKind !== "INCOME")
				.map((r) => amortizationBranch(r, parentOf)),
		);
		expect([...branches].sort()).toEqual(
			["INSTALLMENT_PART", "PLAIN", "REPORTS_ONLY", null].sort(),
		);
		// A child of a missing parent, of no parent and of a REPORTS_ONLY parent never counts.
		const counted = (parentRef: ParentRef) =>
			rows.some(
				(r) =>
					r.spec?.child &&
					!r.spec.parent &&
					r.spec.parentRef === parentRef &&
					spending.has(r.id) &&
					r.spec.status === "FINALIZED" &&
					r.spec.direction === "OUT" &&
					r.spec.entryKind === "STANDARD" &&
					r.spec.category !== "INCOME" &&
					r.spec.date.getTime() >= FROM.getTime(),
			);
		expect(counted("INSTALLMENTS")).toBe(true);
		expect(counted("NONE")).toBe(false);
		expect(counted("MISSING")).toBe(false);
		expect(counted("REPORTS_ONLY")).toBe(false);
	});

	it("money in: both branches that count a row occur", () => {
		const branches = new Set(
			rows.filter((r) => moneyIn.has(r.id)).map((r) => moneyInBranch(r)),
		);
		expect([...branches].sort()).toEqual([
			"INCOME",
			"STARTING_BALANCE_OR_ADJUSTMENT",
		]);
	});

	it("every dimension of the ledger changed some outcome of some rule", () => {
		const flips = (flip: (s: Spec) => Partial<Spec>) =>
			rows.some((r) => {
				if (!r.spec) return false;
				const twin = specIds.get(key({ ...r.spec, ...flip(r.spec) }));
				if (!twin) return false;
				return [spending, refunds, moneyIn, closedIncome].some(
					(set) => set.has(r.id) !== set.has(twin.id),
				);
			});
		expect(
			flips((s) => ({ status: s.status === "DRAFT" ? "FINALIZED" : "DRAFT" })),
		).toBe(true);
		expect(flips((s) => ({ keepInWealth: !s.keepInWealth }))).toBe(true);
		expect(flips((s) => ({ parent: !s.parent }))).toBe(true);
		expect(flips((s) => ({ child: !s.child }))).toBe(true);
		expect(
			flips((s) => ({
				mode: s.mode === "INSTALLMENTS" ? "REPORTS_ONLY" : "INSTALLMENTS",
			})),
		).toBe(true);
		expect(
			flips((s) => ({
				category: s.category === "INCOME" ? "EXPENSE" : "INCOME",
			})),
		).toBe(true);
		// The budget counts the cash that left, hidden or not.
		expect(flips((s) => ({ hidden: !s.hidden }))).toBe(false);
	});

	describe("hand-checked rows, in Postgres", () => {
		it("spending counts from the window's first instant, not the one before", () => {
			expect(spending.has(of({}))).toBe(true);
			expect(spending.has(of({ date: new Date(FROM.getTime() - MS) }))).toBe(
				false,
			);
			expect(spending.has(of({ date: new Date(FROM.getTime() + MS) }))).toBe(
				true,
			);
			// No upper edge: spending runs past the window.
			expect(spending.has(of({ date: new Date(TO.getTime() + MS) }))).toBe(
				true,
			);
		});

		it("spending leaves out drafts, money in, transfers, and income categories, and keeps hidden rows", () => {
			expect(spending.has(of({ status: "DRAFT" }))).toBe(false);
			expect(
				spending.has(
					of({ direction: "IN", entryKind: "STANDARD", inType: "REFUND" }),
				),
			).toBe(false);
			expect(spending.has(of({ entryKind: "NOT_SPENDING" }))).toBe(false);
			expect(spending.has(of({ entryKind: "ADJUSTMENT" }))).toBe(false);
			expect(spending.has(of({ category: "INCOME" }))).toBe(false);
			expect(spending.has(of({ hidden: true }))).toBe(true);
		});

		it("an uncategorized expense counts as spending and a refund", () => {
			expect(spending.has(of({ category: "NONE" }))).toBe(true);
			const refund: Partial<Spec> = { direction: "IN", inType: "REFUND" };
			expect(refunds.has(of({ ...refund, category: "NONE" }))).toBe(true);
			expect(refunds.has(of({ ...refund, category: "INCOME" }))).toBe(false);
		});

		it("an amortized purchase counts by its mode: parts of INSTALLMENTS, the whole of REPORTS_ONLY", () => {
			const parent = { parent: true, child: false } as const;
			expect(spending.has(of({ ...parent, mode: "REPORTS_ONLY" }))).toBe(true);
			expect(spending.has(of({ ...parent, mode: "INSTALLMENTS" }))).toBe(false);
			const part = { parent: false, child: true } as const;
			expect(spending.has(of({ ...part, parentRef: "INSTALLMENTS" }))).toBe(
				true,
			);
			expect(spending.has(of({ ...part, parentRef: "REPORTS_ONLY" }))).toBe(
				false,
			);
			expect(spending.has(of({ ...part, parentRef: "MISSING" }))).toBe(false);
			expect(spending.has(of({ ...part, parentRef: "NONE" }))).toBe(false);
		});

		it("refunds net in their own month and keep hidden rows", () => {
			const refund: Partial<Spec> = { direction: "IN", inType: "REFUND" };
			expect(refunds.has(of(refund))).toBe(true);
			expect(
				refunds.has(of({ ...refund, date: new Date(FROM.getTime() - MS) })),
			).toBe(false);
			expect(refunds.has(of({ ...refund, hidden: true }))).toBe(true);
			expect(refunds.has(of({ ...refund, inType: "INCOME" }))).toBe(false);
			expect(refunds.has(of({ ...refund, status: "DRAFT" }))).toBe(false);
		});

		it("money in is income, the starting balance and adjustments, not kept-in-Wealth income or transfers", () => {
			const income: Partial<Spec> = { direction: "IN", inType: "INCOME" };
			expect(moneyIn.has(of(income))).toBe(true);
			expect(moneyIn.has(of({ ...income, keepInWealth: true }))).toBe(false);
			expect(moneyIn.has(of({ ...income, inType: "REFUND" }))).toBe(false);
			expect(
				moneyIn.has(of({ entryKind: "STARTING_BALANCE", direction: "IN" })),
			).toBe(true);
			// An OUT adjustment is money in too: it lowers Not planned yet.
			expect(moneyIn.has(of({ entryKind: "ADJUSTMENT" }))).toBe(true);
			expect(moneyIn.has(of({ entryKind: "NOT_SPENDING" }))).toBe(false);
			expect(
				moneyIn.has(of({ ...income, date: new Date(FROM.getTime() - MS) })),
			).toBe(false);
			expect(moneyIn.has(of({ ...income, status: "DRAFT" }))).toBe(false);
			// Income in an income category is the usual case and counts.
			expect(moneyIn.has(of({ ...income, category: "INCOME" }))).toBe(true);
		});

		it("typical income reads standard income in [from, to) only", () => {
			const income: Partial<Spec> = { direction: "IN", inType: "INCOME" };
			const at = (date: Date) => closedIncome.has(of({ ...income, date }));
			expect(at(new Date(FROM.getTime() - MS))).toBe(false);
			expect(at(FROM)).toBe(true);
			expect(at(new Date(TO.getTime() - MS))).toBe(true);
			expect(at(TO)).toBe(false);
			expect(at(new Date(TO.getTime() + MS))).toBe(false);
			expect(closedIncome.has(of({ ...income, keepInWealth: true }))).toBe(
				false,
			);
			// A starting balance or an adjustment is never typical income.
			expect(
				closedIncome.has(
					of({ entryKind: "STARTING_BALANCE", direction: "IN" }),
				),
			).toBe(false);
			expect(closedIncome.has(of({ entryKind: "ADJUSTMENT" }))).toBe(false);
		});
	});
});
