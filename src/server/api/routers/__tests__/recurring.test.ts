/**
 * Recurring confirm (batch 3, bug 5): the rate never defaults to 1, monthly
 * steps keep their anchor day, and a double confirm books one expense.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMonthsClamped, nextRecurringDate } from "~/lib/recurring";
import { createMockDb } from "~/test/mock-db";
import { RATE_DATE, useRateTable } from "~/test/rate-table";

type Template = {
	id: string;
	userId: string;
	name: string;
	amount: number;
	currency: string;
	categoryId: string | null;
	frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
	nextDueDate: Date;
	anchorDay: number | null;
	isActive: boolean;
	direction?: "OUT" | "IN";
	amountMode?: "FIXED" | "ASK";
};

const state = vi.hoisted(() => ({
	template: null as null | Template,
	expenses: [] as Array<Record<string, unknown>>,
}));

const mockDb = vi.hoisted(() => ({}) as ReturnType<typeof createMockDb>);

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));

vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { callAndFlush, makeSession } from "~/test/trpc-test-utils";
import { recurringRouter } from "../recurring";

const createCaller = createCallerFactory(recurringRouter);
const caller = () =>
	createCaller({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers: new Headers(),
	});

function local(y: number, m: number, d: number) {
	return new Date(y, m - 1, d, 12, 0, 0);
}

function setTemplate(overrides: Partial<Template> = {}) {
	state.template = {
		id: "cltemplate00000000000001",
		userId: "user-1",
		name: "Rent",
		amount: 100000,
		currency: "ARS",
		categoryId: null,
		frequency: "MONTHLY",
		nextDueDate: local(2026, 1, 31),
		anchorDay: 31,
		isActive: true,
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
	useRateTable(mockDb);
	// The posted row books its home leg (2A.2); these cases pin the entry leg.
	mockDb.user.findUnique.mockResolvedValue({
		homeCurrency: "USD",
		defaultRateTypes: {},
	});
	state.expenses = [];
	setTemplate();

	Object.assign(mockDb.recurringTemplate, {
		findFirst: vi.fn(async () =>
			state.template ? { ...state.template } : null,
		),
		updateMany: vi.fn(
			async (args: {
				where: { id: string; nextDueDate: Date };
				data: Partial<Template>;
			}) => {
				const t = state.template;
				if (
					!t ||
					t.id !== args.where.id ||
					t.nextDueDate.getTime() !== args.where.nextDueDate.getTime()
				) {
					return { count: 0 };
				}
				Object.assign(t, args.data);
				return { count: 1 };
			},
		),
	});
	mockDb.expense.create.mockImplementation(
		async (args: { data: Record<string, unknown> }) => {
			state.expenses.push(args.data);
			return { id: `exp-${state.expenses.length}`, ...args.data };
		},
	);
	// Serialize interactive transactions like row locks would.
	let chain = Promise.resolve<unknown>(undefined);
	mockDb.$transaction.mockImplementation(
		(fn: (tx: unknown) => Promise<unknown>) => {
			const run = chain.then(() => fn(mockDb));
			chain = run.catch(() => undefined);
			return run;
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("month stepping", () => {
	it("Jan 31 monthly goes Feb 28, Mar 31, Apr 30 instead of drifting to the 3rd", () => {
		let d = local(2026, 1, 31);
		const seen: string[] = [];
		for (let i = 0; i < 4; i++) {
			d = nextRecurringDate(d, "MONTHLY", 31);
			seen.push(`${d.getMonth() + 1}/${d.getDate()}`);
		}
		expect(seen).toEqual(["2/28", "3/31", "4/30", "5/31"]);
	});

	it("leap years land on Feb 29", () => {
		const d = nextRecurringDate(local(2028, 1, 31), "MONTHLY", 31);
		expect(d.getMonth() + 1).toBe(2);
		expect(d.getDate()).toBe(29);
	});

	it("quarterly and yearly clamp too", () => {
		const q = nextRecurringDate(local(2025, 11, 30), "QUARTERLY", 30);
		expect([q.getMonth() + 1, q.getDate()]).toEqual([2, 28]);
		const y = nextRecurringDate(local(2028, 2, 29), "YEARLY", 29);
		expect([y.getFullYear(), y.getMonth() + 1, y.getDate()]).toEqual([
			2029, 2, 28,
		]);
	});

	it("without an anchor uses the date's own day", () => {
		const d = addMonthsClamped(local(2026, 3, 15), 1);
		expect([d.getMonth() + 1, d.getDate()]).toEqual([4, 15]);
	});

	it("weekly stays a plain 7 days", () => {
		const d = nextRecurringDate(local(2026, 1, 31), "WEEKLY");
		expect([d.getMonth() + 1, d.getDate()]).toEqual([2, 7]);
	});
});

describe("recurring.confirmAndCreate", () => {
	it("books the expense at the table rate and steps to Feb 28", async () => {
		await callAndFlush(() =>
			caller().confirmAndCreate({ id: "cltemplate00000000000001" }),
		);

		expect(state.expenses).toHaveLength(1);
		expect(state.expenses[0]).toMatchObject({
			exchangeRate: 1560,
			amountInUSD: 64.1,
			currency: "ARS",
		});
		const next = state.template!.nextDueDate;
		expect([next.getMonth() + 1, next.getDate()]).toEqual([2, 28]);
		expect(state.template!.anchorDay).toBe(31);
	});

	it("double confirm creates a single expense", async () => {
		const results = await callAndFlush(() =>
			Promise.allSettled([
				caller().confirmAndCreate({
					id: "cltemplate00000000000001",
					dueDate: local(2026, 1, 31),
				}),
				caller().confirmAndCreate({
					id: "cltemplate00000000000001",
					dueDate: local(2026, 1, 31),
				}),
			]),
		);

		expect(state.expenses).toHaveLength(1);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected") as
			| PromiseRejectedResult
			| undefined;
		expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
	});

	it("a repeated confirm after the first finished is rejected too", async () => {
		const confirm = () =>
			caller().confirmAndCreate({
				id: "cltemplate00000000000001",
				dueDate: local(2026, 1, 31),
			});
		await callAndFlush(confirm);
		await expect(callAndFlush(confirm)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(state.expenses).toHaveLength(1);
	});

	it("a template that is not due yet cannot be confirmed", async () => {
		setTemplate({ nextDueDate: new Date(Date.now() + 5 * 86400000) });
		await expect(
			callAndFlush(() =>
				caller().confirmAndCreate({ id: "cltemplate00000000000001" }),
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(state.expenses).toHaveLength(0);
	});

	it("a past due date with only a newer rate uses that rate, not 1", async () => {
		setTemplate({ nextDueDate: local(2025, 6, 10), anchorDay: 10 });

		await callAndFlush(() =>
			caller().confirmAndCreate({ id: "cltemplate00000000000001" }),
		);

		expect(RATE_DATE > local(2025, 6, 10)).toBe(true);
		expect(state.expenses[0]).toMatchObject({ exchangeRate: 1560 });
	});

	it("a currency without any rate fails and books nothing", async () => {
		useRateTable(mockDb, []);

		await expect(
			callAndFlush(() =>
				caller().confirmAndCreate({ id: "cltemplate00000000000001" }),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(state.expenses).toHaveLength(0);
		expect(state.template!.nextDueDate.getDate()).toBe(31);
	});

	it.each([
		["BRL", 51.178, 10],
		["BTC", 0.001, 64.55],
		["USD", 12.5, 12.5],
	])(
		"%s templates convert with the stored convention",
		async (currency, amount, usd) => {
			setTemplate({ currency, amount });

			await callAndFlush(() =>
				caller().confirmAndCreate({ id: "cltemplate00000000000001" }),
			);

			expect(state.expenses[0]).toMatchObject({ amountInUSD: usd });
		},
	);
});

describe("recurring money in and amounts that vary", () => {
	const id = "cltemplate00000000000001";
	const confirm = (amount?: number) =>
		callAndFlush(() => caller().confirmAndCreate({ id, amount }));

	it("posts a recurring expense as spending", async () => {
		await confirm();
		expect(state.expenses[0]).toMatchObject({ direction: "OUT", inType: null });
	});

	it("posts recurring income as money in, never as spending", async () => {
		setTemplate({ name: "Salary", direction: "IN" });
		await confirm();
		expect(state.expenses[0]).toMatchObject({
			title: "Salary",
			direction: "IN",
			inType: "INCOME",
			amount: 100000,
		});
	});

	it("books the confirmed amount when the amount varies", async () => {
		setTemplate({ direction: "IN", amountMode: "ASK" });
		await confirm(123_456);
		// ARS 123,456 at 1,560 per USD
		expect(state.expenses[0]).toMatchObject({
			// Stored as typed: the amount travels as decimal text.
			amount: "123456",
			amountInUSD: 79.14,
		});
	});

	it("needs an amount when it varies and refuses one when it is fixed", async () => {
		setTemplate({ amountMode: "ASK" });
		await expect(confirm()).rejects.toMatchObject({ code: "BAD_REQUEST" });
		setTemplate({ amountMode: "FIXED" });
		await expect(confirm(5)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(state.expenses).toHaveLength(0);
		expect(state.template!.nextDueDate.getDate()).toBe(31);
	});

	it("lists templates whose amount varies as pending, whatever autoPay says", async () => {
		await callAndFlush(() => caller().getPendingConfirmation());
		expect(mockDb.recurringTemplate.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					OR: [{ autoPay: false }, { amountMode: "ASK" }],
				}),
			}),
		);
	});
});

describe("recurring.list home-currency amounts", () => {
	it("converts by the money rules and leaves a missing rate as null", async () => {
		mockDb.recurringTemplate.findMany.mockResolvedValue([
			{ id: "t1", amount: 50000, currency: "ARS", isActive: true },
			{ id: "t2", amount: 10, currency: "USD", isActive: true },
			{ id: "t3", amount: 0.001, currency: "BTC", isActive: true },
			{ id: "t4", amount: 5, currency: "XYZ", isActive: true },
		]);
		mockDb.user.findUnique.mockResolvedValue({ homeCurrency: "ARS" });

		const list = await callAndFlush(() => caller().list());
		const byId = Object.fromEntries(
			list.map((t) => [t.id, t.amountInHomeCurrency]),
		);

		expect(byId.t1).toBe(50000);
		expect(byId.t2).toBeCloseTo(10 * 1560);
		expect(byId.t3).toBeCloseTo(0.001 * 64545.9 * 1560, 2);
		expect(byId.t4).toBeNull();
	});
});
