import type { RetrospendClient } from "@retrospend/api-client";
import {
	type Draft,
	linesWith,
	nextMonthKey,
	planBody,
	whatIfBody,
} from "./draftsBody";
import { FundNowSheet } from "./FundNowSheet";
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
import { PlanApplySheet } from "./PlanApplySheet";
import { PlanSheet } from "./PlanSheet";
import type { BudgetMonth } from "./source";
import { WhatIfSheet } from "./WhatIfSheet";

// The plan for a coming month and What if. A plan line is a draft write (no
// money moves, Undo restores the previous lines); applying and funding are
// previewed money writes written once with the previewed body.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("./harness").sessionMock);
jest.mock("@/data/ids", () => require("./harness").idsMock);
jest.mock("@/ui/Toast", () => require("./harness").toastMock);
jest.mock("@/ui/Button", () => require("./harness").buttonMock);
jest.mock("@/ui/Sheet", () => require("./harness").sheetMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("./harness").intlMock);

const ars = (minor: number) => ({ minor, currency: "ARS" });
const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-else" },
	month: { key: 202611, state: "NEXT" },
	toAssign: { poolName: "NOT_PLANNED_YET", amount: ars(0) },
	groups: [
		{
			id: "g1",
			name: "Spending",
			envelopes: [
				{ id: "e-food", name: "Food", left: ars(1_000), target: null },
				{ id: "e-rent", name: "Rent", left: ars(0), target: null },
			],
		},
	],
} as unknown as BudgetMonth;

const draft = (over: Record<string, unknown> = {}) =>
	({
		id: "d1",
		kind: "PLAN",
		month: 202611,
		status: "OPEN",
		lines: [{ envelopeId: "e-rent", amount: ars(80_000) }],
		moves: [],
		expectedIn: [],
		pretend: [],
		appliedAt: null,
		fundedBatchId: null,
		updatedAt: "2026-10-20T00:00:00Z",
		...over,
	}) as unknown as Draft;

beforeEach(() => {
	ids.counter = 0;
	toast.show.mockClear();
});

describe("draft bodies", () => {
	it("steps from December to January", () => {
		expect(nextMonthKey(202610)).toBe(202611);
		expect(nextMonthKey(202612)).toBe(202701);
	});

	it("sets one line and keeps every other, with money as decimal text", () => {
		const lines = linesWith(draft(), "e-food", 25_050, "ARS");
		expect(lines).toEqual([
			{ envelopeId: "e-rent", amount: "800.00" },
			{ envelopeId: "e-food", amount: "250.50" },
		]);
		const body = planBody({ id: "d1", month: 202611, lines, base: draft() });
		expect(body).toMatchObject({
			kind: "PLAN",
			month: 202611,
			moves: [],
			pretend: [],
		});
	});

	it("asks What if only with an envelope and an amount", () => {
		const base = { id: "d", rowId: "r", month: 202610, currency: "ARS" };
		expect(whatIfBody({ ...base, envelopeId: null, minor: 100 })).toBeNull();
		expect(whatIfBody({ ...base, envelopeId: "e", minor: 0 })).toBeNull();
		expect(
			whatIfBody({ ...base, envelopeId: "e", minor: 12_345 })?.pretend,
		).toEqual([
			{
				id: "r",
				kind: "OUT",
				categoryId: null,
				envelopeId: "e",
				amount: "123.45",
			},
		]);
	});
});

describe("Plan the month", () => {
	it("saves one line over the draft and Undo puts the previous lines back", async () => {
		const { api, calls } = fakeBudget({
			reads: { drafts: { month: 202611, open: draft(), saved: null } },
			extra: {
				saveDraft: async (input: unknown) => {
					calls.push({ route: "saveDraft", input });
					return draft();
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(<PlanSheet data={data} onClose={jest.fn()} visible />);
		});
		await wait(10);
		press(tree, "Food");
		expect(disabled(tree, "Save")).toBe(true);
		press(tree, "2");
		press(tree, "5");
		press(tree, "0");
		press(tree, "Save");
		await wait(30);
		const saves = calls.filter((c) => c.route === "saveDraft");
		expect(saves).toHaveLength(1);
		expect(saves[0]?.input).toMatchObject({
			id: "d1",
			kind: "PLAN",
			month: 202611,
			lines: [
				{ envelopeId: "e-rent", amount: "800.00" },
				{ envelopeId: "e-food", amount: "250.00" },
			],
		});
		await undoFromToast();
		const after = calls.filter((c) => c.route === "saveDraft");
		expect(after).toHaveLength(2);
		expect(after[1]?.input).toMatchObject({
			id: "d1",
			lines: [{ envelopeId: "e-rent", amount: "800.00" }],
		});
		act(() => tree.unmount());
	});

	it("keeps Save off until the plan is read, so a save never starts from nothing", async () => {
		const { api, calls } = fakeBudget({
			extra: {
				// The read never answers (slow network).
				drafts: () => new Promise(() => undefined),
				saveDraft: async (input: unknown) => {
					calls.push({ route: "saveDraft", input });
					return draft();
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(<PlanSheet data={data} onClose={jest.fn()} visible />);
		});
		await wait(10);
		press(tree, "Food");
		press(tree, "2");
		press(tree, "5");
		expect(disabled(tree, "Save")).toBe(true);
		await wait(10);
		expect(calls.filter((c) => c.route === "saveDraft")).toHaveLength(0);
		act(() => tree.unmount());
	});

	it("keeps Save off when the plan could not be read", async () => {
		const { api } = fakeBudget({
			extra: {
				drafts: async () => {
					throw new Error("offline");
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(<PlanSheet data={data} onClose={jest.fn()} visible />);
		});
		await wait(10);
		press(tree, "Food");
		press(tree, "2");
		expect(disabled(tree, "Save")).toBe(true);
		act(() => tree.unmount());
	});
});

describe("Apply the plan", () => {
	it("previews the draft being applied and writes the same body once, with Undo", async () => {
		const { api, calls } = fakeBudget({
			reads: { drafts: { month: 202611, open: draft(), saved: null } },
			previews: ["previewApplyDraft"],
			writes: ["applyDraft"],
			undo: "undo-token-2",
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<PlanApplySheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(400);
		expect(disabled(tree, "Apply plan")).toBe(false);
		press(tree, "Apply plan");
		await wait(50);
		const previews = calls.filter((c) => c.route === "previewApplyDraft");
		const writes = calls.filter((c) => c.route === "applyDraft");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toEqual({ draftId: "d1" });
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toMatch(/^00000000-/);
		await undoFromToast();
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-2",
		});
		act(() => tree.unmount());
	});

	it("says so when there is no plan and keeps the button off", async () => {
		const { api } = fakeBudget({
			reads: { drafts: { month: 202611, open: null, saved: null } },
			previews: ["previewApplyDraft"],
			writes: ["applyDraft"],
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<PlanApplySheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(400);
		expect(disabled(tree, "Apply plan")).toBe(true);
		act(() => tree.unmount());
	});
});

describe("Fund next month now", () => {
	it("funds the saved plan with a batch id that is also the idempotency key", async () => {
		const { api, calls } = fakeBudget({
			reads: {
				drafts: { month: 202611, open: null, saved: draft({ id: "saved1" }) },
			},
			previews: ["previewFundPlanNow"],
			writes: ["fundPlanNow"],
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<FundNowSheet
					data={data}
					next
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(400);
		press(tree, "Fund Oct 1, 2026");
		await wait(50);
		const previews = calls.filter((c) => c.route === "previewFundPlanNow");
		const writes = calls.filter((c) => c.route === "fundPlanNow");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({ draftId: "saved1" });
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toBe(
			(writes[0]?.input as { batchId: string } | undefined)?.batchId,
		);
		act(() => tree.unmount());
	});
});

describe("What if I spend", () => {
	it("saves a pretend expense, reads the outcome, and discards the draft on close", async () => {
		const outcome = {
			draftId: "d",
			kind: "WHAT_IF",
			month: 202611,
			toAssign: { before: ars(0), after: ars(0) },
			envelopes: [
				{
					envelopeId: "e-food",
					assigned: { before: ars(0), after: ars(0) },
					activity: { before: ars(0), after: ars(-10_000) },
					left: { before: ars(1_000), after: ars(-9_000) },
					need: ars(0),
					short: true,
				},
			],
			ruleLines: [],
			shortfalls: [
				{
					envelopeId: "e-food",
					short: ars(9_000),
					cover: [{ from: null, amount: ars(9_000) }],
					uncovered: ars(0),
				},
			],
			fundNow: null,
			incomplete: false,
			stale: false,
		};
		const { api, calls } = fakeBudget({
			reads: { draftOutcome: outcome },
			extra: {
				saveDraft: async (input: unknown) => {
					calls.push({ route: "saveDraft", input });
					return draft();
				},
				discardDraft: async (input: unknown) => {
					calls.push({ route: "discardDraft", input });
					return draft();
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(<WhatIfSheet data={data} onClose={onClose} visible />);
		});
		press(tree, "Food,");
		press(tree, "1");
		press(tree, "0");
		press(tree, "0");
		await wait(450);
		const saves = calls.filter((c) => c.route === "saveDraft");
		expect(saves).toHaveLength(1);
		expect(saves[0]?.input).toMatchObject({
			kind: "WHAT_IF",
			pretend: [{ kind: "OUT", envelopeId: "e-food", amount: "100.00" }],
		});
		expect(calls.some((c) => c.route === "draftOutcome")).toBe(true);
		// It writes no money: there is no write, no preview and no Undo to offer.
		expect(toast.show).not.toHaveBeenCalled();
		// Closing discards the draft that was saved.
		press(tree, "Close sheet");
		await wait(10);
		expect(calls.find((c) => c.route === "discardDraft")?.input).toEqual({
			draftId: (saves[0]?.input as { id: string } | undefined)?.id,
		});
		expect(onClose).toHaveBeenCalled();
		act(() => tree.unmount());
	});

	it("sends saves one at a time, in order, and reads the outcome of the latest only", async () => {
		const { api, calls } = fakeBudget({
			reads: { draftOutcome: { envelopes: [], shortfalls: [] } },
			extra: {
				saveDraft: (input: unknown) => {
					calls.push({ route: "saveDraft", input });
					return new Promise((resolve) => setTimeout(resolve, 1_000));
				},
			},
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(<WhatIfSheet data={data} onClose={jest.fn()} visible />);
		});
		press(tree, "Food,");
		press(tree, "1");
		await wait(350);
		// The first save is on its way; a newer amount waits for it.
		press(tree, "0");
		await wait(350);
		const saves = () =>
			calls
				.filter((c) => c.route === "saveDraft")
				.map((c) => (c.input as { pretend: { amount: string }[] }).pretend);
		expect(saves()).toHaveLength(1);
		await wait(1_000);
		expect(saves().map((p) => p[0]?.amount)).toEqual(["1.00", "10.00"]);
		await wait(1_100);
		expect(calls.filter((c) => c.route === "draftOutcome")).toHaveLength(1);
		act(() => tree.unmount());
	});
});
