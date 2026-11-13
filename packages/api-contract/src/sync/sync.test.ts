import { describe, expect, it } from "vitest";
import { PROBLEM_STATUS } from "../common/errors";
import { isScope, isSessionScope, parseScopeList } from "../common/scopes";
import {
	DEFAULT_SYNC_LIMIT,
	MAX_SYNC_LIMIT,
	syncPageOf,
	syncQuerySchema,
} from "../common/sync";
import { syncContract } from "./index";
import {
	syncCategorySchema,
	syncExpenseSchema,
	syncRecurringTemplateSchema,
} from "./schemas";

const at = "2026-10-05T00:00:00.000Z";

const expense = {
	id: "e1",
	title: "Coffee",
	amount: "100",
	currency: "ARS",
	date: at,
	categoryId: null,
	amountInUSD: "0.07",
	exchangeRate: "1468",
	pricingSource: "MANUAL",
	location: null,
	description: null,
	status: "FINALIZED",
	createdAt: at,
	updatedAt: at,
	isAmortizedParent: false,
	isAmortizedChild: false,
	parentId: null,
	recurringTemplateId: null,
	excludeFromAnalytics: false,
	direction: "OUT",
	entryKind: "STANDARD",
	inType: null,
	amortizeMode: "INSTALLMENTS",
	keepInWealth: false,
	budgetEnvelopeId: null,
	movedInAt: null,
	planBatchId: null,
	rateType: null,
	homeCurrency: null,
	homeRate: null,
	homeAmount: null,
	importFingerprint: null,
};

describe("syncQuerySchema", () => {
	it("defaults the limit and takes no cursor", () => {
		expect(syncQuerySchema.parse({})).toEqual({ limit: DEFAULT_SYNC_LIMIT });
		expect(DEFAULT_SYNC_LIMIT).toBe(200);
	});

	it("accepts a limit up to 500 and an opaque since up to 512 characters", () => {
		expect(
			syncQuerySchema.parse({ limit: "500", since: "a".repeat(512) }),
		).toEqual({ limit: 500, since: "a".repeat(512) });
		expect(MAX_SYNC_LIMIT).toBe(500);
	});

	it("refuses a limit of 0 or 501, an empty since and one past 512", () => {
		expect(syncQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
		expect(syncQuerySchema.safeParse({ limit: 501 }).success).toBe(false);
		expect(syncQuerySchema.safeParse({ since: "" }).success).toBe(false);
		expect(syncQuerySchema.safeParse({ since: "a".repeat(513) }).success).toBe(
			false,
		);
	});
});

describe("syncPageOf", () => {
	const page = syncPageOf(syncExpenseSchema);

	it("round trips a page of rows and tombstones", () => {
		const input = {
			items: [expense],
			tombstones: [{ id: "e2", deletedAt: at }],
			cursor: "abc",
			hasMore: true,
		};
		expect(page.parse(input)).toEqual(input);
	});

	it("needs a cursor and hasMore, and a tombstone needs an ISO instant", () => {
		expect(
			page.safeParse({ items: [], tombstones: [], hasMore: false }).success,
		).toBe(false);
		expect(
			page.safeParse({
				items: [],
				tombstones: [{ id: "x", deletedAt: "yesterday" }],
				cursor: "c",
				hasMore: false,
			}).success,
		).toBe(false);
	});
});

describe("raw row schemas", () => {
	it("takes decimals as text, never as a number", () => {
		expect(
			syncExpenseSchema.safeParse({ ...expense, amount: 100 }).success,
		).toBe(false);
		expect(
			syncExpenseSchema.safeParse({ ...expense, homeRate: "1468.5" }).success,
		).toBe(true);
	});

	it("round trips a category and a recurring template", () => {
		const category = {
			id: "c1",
			name: "Food",
			color: "emerald",
			icon: null,
			isFixed: false,
			excludeByDefault: false,
			kind: "EXPENSE",
		};
		expect(syncCategorySchema.parse(category)).toEqual(category);
		const template = {
			id: "t1",
			name: "Rent",
			amount: "100",
			currency: "ARS",
			categoryId: null,
			direction: "OUT",
			amountMode: "FIXED",
			frequency: "MONTHLY",
			nextDueDate: at,
			anchorDay: null,
			websiteUrl: null,
			paymentSource: null,
			autoPay: true,
			isActive: true,
			createdAt: at,
			updatedAt: at,
		};
		expect(syncRecurringTemplateSchema.parse(template)).toEqual(template);
	});

	it("does not carry the server-only columns", () => {
		expect(Object.keys(syncCategorySchema.shape)).not.toContain("nameIndex");
		expect(Object.keys(syncCategorySchema.shape)).not.toContain("userId");
		expect(Object.keys(syncExpenseSchema.shape)).not.toContain("userId");
	});
});

describe("the sync group", () => {
	it("answers a stale cursor with 410", () => {
		expect(PROBLEM_STATUS.sync_reset_required).toBe(410);
	});

	it("needs the session-only sync scope, which no token can be given", () => {
		for (const route of Object.values(syncContract)) {
			expect(route["~orpc"].meta.scope).toBe("sync");
		}
		expect(isSessionScope("sync")).toBe(true);
		expect(isScope("sync")).toBe(false);
		expect(parseScopeList("read sync").unknown).toEqual(["sync"]);
	});
});
