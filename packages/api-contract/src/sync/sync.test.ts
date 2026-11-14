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
import { SYNC_DESCRIPTION } from "./route";
import {
	syncAccountHistorySchema,
	syncAccountLegSchema,
	syncAccountRateTypeSchema,
	syncAccountSchema,
	syncAccountSnapshotSchema,
	syncCategorySchema,
	syncExpenseSchema,
	syncRecurringTemplateSchema,
	syncTransferSchema,
} from "./schemas";
import {
	syncSettingsSchema,
	syncSharesQuerySchema,
	syncSharesSchema,
} from "./snapshots";

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

	it("round trips each account row with decimals as text and no userId", () => {
		const account = {
			id: "a1",
			name: "Cash",
			type: "CASH",
			currency: "ARS",
			balance: "-1000.5",
			exchangeRate: null,
			exchangeRateType: "blue",
			isLiquid: true,
			interestRate: "0.123456",
			minimumPayment: null,
			dueDate: 15,
			inBudget: null,
			countedUnits: "0",
			closedAt: null,
			iconKind: "BRAND",
			iconValue: "revolut",
			createdAt: at,
			updatedAt: at,
		};
		const snapshot = {
			id: "s1",
			accountId: "a1",
			date: at,
			balance: "1000",
			balanceInUSD: "0.68",
			currency: null,
			type: null,
			exchangeRateType: null,
			recordedAt: at,
		};
		const leg = {
			id: "l1",
			accountId: null,
			currency: "ARS",
			amount: "-50",
			homeAmount: null,
			homeCurrency: null,
			date: at,
			source: "BALANCE_UPDATE",
			transferId: null,
			expenseId: "e1",
			countedUnits: "0",
			createdAt: at,
		};
		const history = { id: "h1", assetId: "a1", balance: "1", recordedAt: at };
		const rateType = {
			id: "r1",
			accountId: "a1",
			from: at,
			type: null,
			previousType: "official",
			createdAt: at,
		};
		const transfer = {
			id: "t1",
			kind: "EXCHANGE",
			date: at,
			fromAccountId: "a1",
			fromAmount: "100",
			fromCurrency: "USD",
			toAccountId: null,
			toAmount: "146800",
			toCurrency: "ARS",
			referenceRateType: "blue",
			feeExpenseId: null,
			countedFromUnits: "0",
			countedToUnits: "0",
			note: null,
			createdAt: at,
		};
		expect(syncAccountSchema.parse(account)).toEqual(account);
		expect(syncAccountSnapshotSchema.parse(snapshot)).toEqual(snapshot);
		expect(syncAccountLegSchema.parse(leg)).toEqual(leg);
		expect(syncAccountHistorySchema.parse(history)).toEqual(history);
		expect(syncAccountRateTypeSchema.parse(rateType)).toEqual(rateType);
		expect(syncTransferSchema.parse(transfer)).toEqual(transfer);
		expect(
			syncAccountSchema.safeParse({ ...account, balance: 1000 }).success,
		).toBe(false);
		expect(
			syncTransferSchema.safeParse({ ...transfer, kind: "GIFT" }).success,
		).toBe(false);
		for (const schema of [
			syncAccountSchema,
			syncAccountSnapshotSchema,
			syncAccountLegSchema,
			syncAccountHistorySchema,
			syncAccountRateTypeSchema,
			syncTransferSchema,
		]) {
			expect(Object.keys(schema.shape)).not.toContain("userId");
		}
	});

	it("does not carry the server-only columns", () => {
		expect(Object.keys(syncCategorySchema.shape)).not.toContain("nameIndex");
		expect(Object.keys(syncCategorySchema.shape)).not.toContain("userId");
		expect(Object.keys(syncExpenseSchema.shape)).not.toContain("userId");
	});
});

describe("the shares snapshot", () => {
	const share = {
		id: "p1",
		expenseId: "x1",
		shareAmount: "-12.50",
		verificationStatus: "REJECTED",
		currency: "ARS",
		date: at,
		projectId: null,
		exchangeRate: null,
		expenseCategoryId: null,
	};

	it("takes a negative correction share and either owed reading", () => {
		const priced = syncSharesSchema.parse({
			items: [share],
			owed: {
				owedToYou: { minor: 500, currency: "ARS" },
				youOwe: { minor: 0, currency: "ARS" },
			},
		});
		expect(priced.items[0]?.shareAmount).toBe("-12.50");
		expect(
			syncSharesSchema.parse({ items: [], owed: { missingRates: ["XQZ"] } })
				.owed,
		).toEqual({ missingRates: ["XQZ"] });
	});

	it("refuses an owed reading with neither totals nor missing rates", () => {
		expect(syncSharesSchema.safeParse({ items: [], owed: {} }).success).toBe(
			false,
		);
	});

	it("carries no text of the expense, its payer or its other people", () => {
		const keys = Object.keys(share);
		for (const leaked of ["description", "paidById", "participants", "notes"])
			expect(keys).not.toContain(leaked);
		// The schema strips what it does not name, so a row with them parses without them.
		const parsed = syncSharesSchema.parse({
			items: [{ ...share, description: "dinner", paidById: "bob" }],
			owed: { missingRates: [] },
		});
		expect(Object.keys(parsed.items[0] ?? {}).sort()).toEqual(
			Object.keys(share).sort(),
		);
	});
});

describe("the shares snapshot's budget block", () => {
	const empty = {
		shares: [],
		effects: [],
		balances: [],
		ignored: [],
		events: [],
		pending: [],
		unresolved: [],
		notInBudget: [],
		missingRates: [],
		approximate: [],
		checkpointMissingRates: [],
		checkpointApproximate: [],
	};
	const block = {
		bookId: "b1",
		valuationKey: "key",
		asOf: "cursor",
		frozen: [
			{
				key: "x1|USD|10|10|2026-11-08|blue",
				minor: 1500000,
				approximate: false,
			},
		],
		splits: empty,
	};
	const base = { items: [], owed: { missingRates: [] } };

	it("is absent without the flag, and takes null, a block or the unavailable shape", () => {
		expect(syncSharesSchema.parse(base).budget).toBeUndefined();
		expect(syncSharesSchema.parse({ ...base, budget: null }).budget).toBeNull();
		expect(
			syncSharesSchema.parse({ ...base, budget: { unavailable: true } }).budget,
		).toEqual({ unavailable: true });
		expect(syncSharesSchema.parse({ ...base, budget: block }).budget).toEqual(
			block,
		);
	});

	it("keeps unavailable apart from null and from an empty object", () => {
		expect(syncSharesSchema.safeParse({ ...base, budget: {} }).success).toBe(
			false,
		);
		expect(
			syncSharesSchema.safeParse({ ...base, budget: { unavailable: false } })
				.success,
		).toBe(false);
	});

	it("takes the flag as 1 only", () => {
		expect(syncSharesQuerySchema.parse({}).budget).toBeUndefined();
		expect(syncSharesQuerySchema.parse({ budget: "1" }).budget).toBe("1");
		expect(syncSharesQuerySchema.safeParse({ budget: "0" }).success).toBe(
			false,
		);
	});

	it("takes a replay event of every kind", () => {
		const e = {
			id: "e1",
			counterparty: "p1",
			currency: "USD",
			date: "2026-11-10",
			month: 202611,
			native: 3000,
		};
		const events = [
			{ ...e, kind: "FRONT", value: 4500000, shareStatus: "ACCEPTED" },
			{ ...e, kind: "OWE", status: "PENDING" },
			{ ...e, kind: "UNFRONT" },
			{
				...e,
				kind: "RECV",
				status: "FINALIZED",
				cash: 4500000,
				isOffset: false,
			},
			{ ...e, kind: "PAY", status: "PROPOSED", cash: 0, forgiven: true },
			{ ...e, kind: "FORGIVE", status: "FINALIZED", envelopeId: null },
		];
		const parsed = syncSharesSchema.parse({
			...base,
			budget: { ...block, splits: { ...empty, events } },
		});
		const kinds =
			parsed.budget && "splits" in parsed.budget
				? parsed.budget.splits.events.map((x) => x.kind)
				: [];
		expect(kinds).toEqual([
			"FRONT",
			"OWE",
			"UNFRONT",
			"RECV",
			"PAY",
			"FORGIVE",
		]);
	});
});

describe("the settings snapshot", () => {
	const settings = {
		homeCurrency: "ARS",
		timeZone: "America/Argentina/Buenos_Aires",
		startDay: 1,
		hiddenProjectIds: [],
		defaultRateTypes: {},
	};

	it("takes the port's settings fields, never a null zone", () => {
		expect(syncSettingsSchema.parse(settings)).toEqual(settings);
		expect(
			syncSettingsSchema.safeParse({ ...settings, timeZone: null }).success,
		).toBe(false);
		expect(
			syncSettingsSchema.safeParse({ ...settings, startDay: 29 }).success,
		).toBe(false);
	});

	it("keeps the preferred rate type per currency", () => {
		const parsed = syncSettingsSchema.parse({
			...settings,
			hiddenProjectIds: ["p1"],
			defaultRateTypes: { ARS: "blue" },
		});
		expect(parsed.defaultRateTypes).toEqual({ ARS: "blue" });
		expect(parsed.hiddenProjectIds).toEqual(["p1"]);
	});
});

describe("the sync group", () => {
	it("answers a stale cursor with 410", () => {
		expect(PROBLEM_STATUS.sync_reset_required).toBe(410);
	});

	const pathsOf = (snapshot: boolean) =>
		Object.values(syncContract)
			.filter((route) => (route["~orpc"].meta.snapshot === true) === snapshot)
			.map((route) => route["~orpc"].route.path);

	it("has the 21 cursor routes, each a GET under /sync", () => {
		expect(pathsOf(false).sort()).toEqual(
			[
				"/sync/account-history",
				"/sync/account-legs",
				"/sync/account-rate-types",
				"/sync/account-snapshots",
				"/sync/accounts",
				"/sync/book-periods",
				"/sync/budget-books",
				"/sync/budget-movements",
				"/sync/categories",
				"/sync/envelope-categories",
				"/sync/envelope-changes",
				"/sync/envelope-groups",
				"/sync/envelopes",
				"/sync/expenses",
				"/sync/income-rule-runs",
				"/sync/income-rules",
				"/sync/month-closes",
				"/sync/payoff-plans",
				"/sync/recurring-templates",
				"/sync/transfers",
				"/sync/wealth-transfers",
			].sort(),
		);
	});

	it("has the snapshots, which take no cursor and say so", () => {
		expect(pathsOf(true).sort()).toEqual(["/sync/settings", "/sync/shares"]);
		for (const route of Object.values(syncContract)) {
			if (route["~orpc"].meta.snapshot !== true) continue;
			// No `since` or `limit`: a snapshot is one table, replaced on each pull.
			// The one input any takes is shares' opt-in `budget` flag.
			if (route["~orpc"].route.path === "/sync/shares")
				expect(route["~orpc"].inputSchema).toBe(syncSharesQuerySchema);
			else expect(route["~orpc"].inputSchema).toBeUndefined();
			expect(Object.keys(syncSharesQuerySchema.shape)).toEqual(["budget"]);
			expect(route["~orpc"].route.description).not.toContain(SYNC_DESCRIPTION);
		}
	});

	it("needs the session-only sync scope, which no token can be given", () => {
		for (const route of Object.values(syncContract)) {
			expect(route["~orpc"].meta.scope).toBe("sync");
			expect(route["~orpc"].route.method).toBe("GET");
		}
		expect(isSessionScope("sync")).toBe(true);
		expect(isScope("sync")).toBe(false);
		expect(parseScopeList("read sync").unknown).toEqual(["sync"]);
	});
});
