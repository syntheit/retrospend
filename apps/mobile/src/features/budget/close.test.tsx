import type { RetrospendClient } from "@retrospend/api-client";
import { subscribeEntryChanges } from "@/features/entry/events";
import { CloseSheet } from "./CloseSheet";
import {
	acknowledgeBody,
	carryBody,
	type MonthSummary,
	startingMoneyBody,
	welcomeBackBody,
} from "./closeBodies";
import {
	disabled,
	fakeBudget,
	ids,
	press,
	session,
	type Tree,
	toast,
	undoFromToast,
	wait,
} from "./harness";
import { StartingMoneySheet } from "./StartingMoneySheet";
import type { BudgetMonth } from "./source";
import { WealthMoveSheet } from "./WealthMoveSheet";
import { WelcomeBackSheet } from "./WelcomeBackSheet";
import { wealthMoveBody } from "./wealthBodies";

// Closing a month, coming back, starting money and moving money to or from
// Wealth: each write is previewed first, written once with the previewed body
// and the same idempotency key, and ends in an Undo toast with the server's
// token (the transfer's token goes to the transfers undo).
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("./harness").sessionMock);
jest.mock("@/data/ids", () => require("./harness").idsMock);
jest.mock("@/ui/Toast", () => require("./harness").toastMock);
jest.mock("@/ui/Button", () => require("./harness").buttonMock);
jest.mock("@/ui/Sheet", () => require("./harness").sheetMock);
jest.mock("@/ui/Segmented", () => require("./harness").segmentedMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("./harness").intlMock);

const ars = (minor: number) => ({ minor, currency: "ARS" });
const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-else" },
	month: { key: 202609, state: "CLOSED" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [
		{
			id: "g1",
			name: "Spending",
			envelopes: [
				{ id: "e-food", name: "Food", left: ars(1_000) },
				{ id: "e-else", name: "Everything else", left: ars(0) },
			],
		},
	],
} as unknown as BudgetMonth;

const summary = (acknowledgedRevision: number | null) => ({
	summary: {
		month: 202609,
		currency: "ARS",
		moneyIn: 100_000,
		assigned: 90_000,
		overspent: 4_000,
		returned: 0,
		held: [],
		envelopes: [
			{
				id: "e-food",
				carryIn: 0,
				assigned: 50_000,
				activity: -54_000,
				left: -4_000,
				rule: "CARRY",
				sweepToId: null,
				carried: 0,
				returned: 0,
				swept: 0,
				overspent: 4_000,
			},
		],
	},
	closedAt: "2026-10-01T00:00:00Z",
	revision: 2,
	acknowledgedRevision,
	lateEntries: null,
	change: null,
});

beforeEach(() => {
	ids.counter = 0;
	toast.show.mockClear();
});

describe("close bodies", () => {
	it("takes an overspend as decimal text and nothing for zero", () => {
		expect(
			carryBody({ id: "c", envelopeId: "e", minor: 4_000, currency: "ARS" }),
		).toEqual({ id: "c", envelopeId: "e", amount: "40.00" });
		expect(
			carryBody({ id: "c", envelopeId: "e", minor: 0, currency: "ARS" }),
		).toBeNull();
	});

	it("builds the three ways back and waits for an amount on Set what I have", () => {
		const base = { id: "a", batchId: "b", minor: null, currency: "ARS" };
		expect(welcomeBackBody({ ...base, choice: "CATCH_UP" })).toEqual({
			choice: "CATCH_UP",
		});
		expect(welcomeBackBody({ ...base, choice: "START_FRESH" })).toEqual({
			choice: "START_FRESH",
			batchId: "b",
		});
		expect(welcomeBackBody({ ...base, choice: "SET_HAVE_NOW" })).toBeNull();
		expect(
			welcomeBackBody({ ...base, choice: "SET_HAVE_NOW", minor: 0 }),
		).toEqual({ choice: "SET_HAVE_NOW", id: "a", amount: "0.00" });
	});

	it("counts zero as an answer for starting money", () => {
		expect(startingMoneyBody({ id: "s", minor: 0, currency: "ARS" })).toEqual({
			id: "s",
			amount: "0.00",
		});
		expect(
			startingMoneyBody({ id: "s", minor: null, currency: "ARS" }),
		).toBeNull();
	});

	it("acknowledges only a revision not read yet", () => {
		const read = summary(2) as unknown as MonthSummary;
		const unread = summary(1) as unknown as MonthSummary;
		expect(acknowledgeBody(202609, read)).toBeNull();
		expect(acknowledgeBody(202609, unread)).toEqual({
			month: 202609,
			revision: 2,
		});
	});

	it("names the envelope on the side the money leaves or enters", () => {
		const wealth = { id: "w", currency: "USD" };
		const cash = { id: "c", currency: "ARS" };
		const base = {
			id: "m",
			envelopeId: "e-food",
			minor: 5_000,
			bookCurrency: "ARS",
		};
		expect(
			wealthMoveBody({
				...base,
				direction: "to",
				fromPlace: null,
				intoPlace: wealth,
			}),
		).toEqual({
			id: "m",
			fromAccountId: null,
			toAccountId: "w",
			fromCurrency: "ARS",
			toCurrency: "USD",
			fromAmount: "50.00",
			envelopeId: "e-food",
		});
		expect(
			wealthMoveBody({
				...base,
				direction: "from",
				fromPlace: wealth,
				intoPlace: cash,
			}),
		).toEqual({
			id: "m",
			fromAccountId: "w",
			toAccountId: "c",
			fromCurrency: "USD",
			toCurrency: "ARS",
			fromAmount: "50.00",
			putIn: "e-food",
		});
		expect(
			wealthMoveBody({
				...base,
				direction: "to",
				fromPlace: cash,
				intoPlace: null,
			}),
		).toBeNull();
	});
});

describe("Month summary", () => {
	it("acknowledges the revision on Done", async () => {
		const { api, calls } = fakeBudget({
			reads: { monthSummary: summary(1) },
			extra: {
				acknowledgeMonth: async (input: unknown) => {
					calls.push({ route: "acknowledgeMonth", input });
					return {};
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<CloseSheet data={data} onClose={onClose} onDone={jest.fn()} visible />,
			);
		});
		await wait(10);
		press(tree, "Done");
		await wait(20);
		expect(calls.find((c) => c.route === "acknowledgeMonth")?.input).toEqual({
			month: 202609,
			revision: 2,
		});
		expect(onClose).toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("takes an overspend from the envelope's next month with a preview and an Undo", async () => {
		const { api, calls } = fakeBudget({
			reads: { monthSummary: summary(2) },
			previews: ["previewCarryOverspend"],
			writes: ["carryOverspend"],
			undo: "undo-token-5",
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<CloseSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "Take it from Oct 1, 2026 instead");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewCarryOverspend");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			envelopeId: "e-food",
			amount: "40.00",
		});
		press(tree, "Take it from Food");
		await wait(50);
		const writes = calls.filter((c) => c.route === "carryOverspend");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toBe(
			(previews[0]?.input as { id: string } | undefined)?.id,
		);
		// The stored close still says it went over: the row is not offered twice.
		const offered = () =>
			tree.root.findAll(
				(n) =>
					n.props.accessibilityLabel === "Take it from Oct 1, 2026 instead" &&
					typeof n.props.onPress === "function",
			).length;
		expect(offered()).toBe(0);
		// The Undo also tells the other screens (Home, Wealth) to read again.
		const heard = jest.fn();
		const stop = subscribeEntryChanges(heard);
		await undoFromToast();
		stop();
		expect(heard).toHaveBeenCalledTimes(1);
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-5",
		});
		expect(offered()).toBeGreaterThan(0);
		act(() => tree.unmount());
	});
});

describe("Welcome back", () => {
	it("starts fresh with one batch id that is the idempotency key", async () => {
		const { api, calls } = fakeBudget({
			reads: {
				welcomeBackState: {
					pending: true,
					since: "2026-09-01",
					months: [{ month: 202609, revision: 1, acknowledged: false }],
					bank: {
						holds: ars(0),
						accounts: [],
						bank: ars(25_000),
						difference: ars(0),
						held: ars(0),
						reconciledAt: null,
						incomplete: false,
						missingRates: [],
					},
				},
			},
			previews: ["previewWelcomeBack"],
			writes: ["welcomeBack"],
			undo: "undo-token-6",
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<WelcomeBackSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "Start fresh");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewWelcomeBack");
		expect(previews.at(-1)?.input).toMatchObject({ choice: "START_FRESH" });
		press(tree, "Start fresh", true);
		await wait(50);
		const writes = calls.filter((c) => c.route === "welcomeBack");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews.at(-1)?.input);
		expect(writes[0]?.key).toBe(
			(writes[0]?.input as { batchId: string } | undefined)?.batchId,
		);
		await undoFromToast();
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-6",
		});
		act(() => tree.unmount());
	});

	it("keeps Set what I have off until the amount is a number, zero included", async () => {
		const { api, calls } = fakeBudget({
			reads: {
				welcomeBackState: {
					pending: false,
					since: null,
					months: [],
					bank: {
						holds: ars(0),
						accounts: [],
						bank: ars(0),
						difference: ars(0),
						held: ars(0),
						reconciledAt: null,
						incomplete: false,
						missingRates: [],
					},
				},
			},
			previews: ["previewWelcomeBack"],
			writes: ["welcomeBack"],
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<WelcomeBackSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "Set what I have");
		await wait(400);
		// The prefill is the bank side: 0.00 is a real answer.
		expect(
			calls.filter((c) => c.route === "previewWelcomeBack").at(-1)?.input,
		).toMatchObject({
			choice: "SET_HAVE_NOW",
			amount: "0.00",
		});
		expect(disabled(tree, "Set what I have", true)).toBe(false);
		act(() => tree.unmount());
	});
});

describe("Starting money", () => {
	it("previews the answer, writes it once and offers the server's undo", async () => {
		const { api, calls } = fakeBudget({
			previews: ["previewConfirmStartingMoney"],
			writes: ["confirmStartingMoney"],
			undo: "undo-token-8",
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<StartingMoneySheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		expect(disabled(tree, "Confirm")).toBe(true);
		press(tree, "5");
		press(tree, "0");
		await wait(400);
		const previews = calls.filter(
			(c) => c.route === "previewConfirmStartingMoney",
		);
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({ amount: "50.00" });
		press(tree, "Confirm");
		await wait(50);
		const writes = calls.filter((c) => c.route === "confirmStartingMoney");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		await undoFromToast();
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-8",
		});
		act(() => tree.unmount());
	});
});

describe("Move money to Wealth", () => {
	it("writes the transfer with the envelope it leaves and undoes through the transfers route", async () => {
		const account = (id: string, name: string, inBudget: boolean) => ({
			id,
			name,
			type: "CASH",
			currency: "ARS",
			balance: ars(100_000),
			value: ars(100_000),
			inBudget,
			isLiquid: true,
			rateType: null,
			closedAt: null,
			interestRate: null,
			minimumPayment: null,
			dueDay: null,
			updatedAt: "2026-10-01T00:00:00Z",
		});
		const calls: { route: string; input: unknown; key?: string }[] = [];
		const api = {
			accounts: {
				list: async () => ({
					accounts: [
						account("a-save", "Savings", false),
						account("a-cash", "Cash", true),
					],
				}),
			},
			transfers: {
				previewCreate: async (input: unknown) => {
					calls.push({ route: "previewCreate", input });
					return { changes: [], unchanged: [], unavailable: [] };
				},
				create: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({
						route: "create",
						input,
						key: init?.context?.idempotencyKey,
					});
					return { transfer: {}, undo: "undo-token-3" };
				},
				undo: async (input: unknown) => {
					calls.push({ route: "transfersUndo", input });
					return {};
				},
			},
			budget: {
				undo: async () => {
					calls.push({ route: "budgetUndo", input: null });
					return {};
				},
			},
		};
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<WealthMoveSheet
					data={data}
					direction="to"
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "Food,");
		press(tree, "5");
		press(tree, "0");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewCreate");
		expect(previews.at(-1)?.input).toMatchObject({
			fromAccountId: null,
			toAccountId: "a-save",
			fromCurrency: "ARS",
			toCurrency: "ARS",
			fromAmount: "50.00",
			envelopeId: "e-food",
		});
		press(tree, "Move");
		await wait(50);
		const writes = calls.filter((c) => c.route === "create");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews.at(-1)?.input);
		expect(writes[0]?.key).toBe(
			(writes[0]?.input as { id: string } | undefined)?.id,
		);
		await undoFromToast();
		expect(calls.find((c) => c.route === "transfersUndo")?.input).toEqual({
			token: "undo-token-3",
		});
		expect(calls.some((c) => c.route === "budgetUndo")).toBe(false);
		act(() => tree.unmount());
	});
});

describe("Count Wealth money in the budget", () => {
	it("counts units of an account without moving it, with the income undo", async () => {
		const calls: { route: string; input: unknown; key?: string }[] = [];
		const api = {
			accounts: {
				list: async () => ({
					accounts: [
						{
							id: "a-save",
							name: "Savings",
							type: "CASH",
							currency: "ARS",
							balance: ars(100_000),
							value: ars(100_000),
							inBudget: false,
							isLiquid: true,
							rateType: null,
							closedAt: null,
							interestRate: null,
							minimumPayment: null,
							dueDay: null,
							updatedAt: "2026-10-01T00:00:00Z",
						},
					],
				}),
			},
			income: {
				previewMoveIn: async (input: unknown) => {
					calls.push({ route: "previewMoveIn", input });
					return { changes: [], unchanged: [], unavailable: [] };
				},
				moveIn: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({
						route: "moveIn",
						input,
						key: init?.context?.idempotencyKey,
					});
					return { moved: {}, undo: "undo-token-9" };
				},
				undo: async (input: unknown) => {
					calls.push({ route: "incomeUndo", input });
					return {};
				},
			},
		};
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<WealthMoveSheet
					data={data}
					direction="from"
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "No, just count it");
		press(tree, "7");
		press(tree, "5");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewMoveIn");
		expect(previews.at(-1)?.input).toMatchObject({
			accountId: "a-save",
			units: "75.00",
			putIn: null,
		});
		press(tree, "Move in");
		await wait(50);
		const writes = calls.filter((c) => c.route === "moveIn");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews.at(-1)?.input);
		await undoFromToast();
		expect(calls.find((c) => c.route === "incomeUndo")?.input).toEqual({
			token: "undo-token-9",
		});
		act(() => tree.unmount());
	});
});
