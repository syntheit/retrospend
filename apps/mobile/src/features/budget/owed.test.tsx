import type { RetrospendClient } from "@retrospend/api-client";
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
import { OwedSheet } from "./OwedSheet";
import {
	forgivable,
	forgiveBody,
	type OwedPerson,
	shareCategoryBody,
} from "./owedBodies";
import type { BudgetMonth } from "./source";
import { UnroutedSheet } from "./UnroutedSheet";

// Money owed to you and shares with no envelope: Forgive and the category
// pick are previewed writes, written once with the previewed body, and end in
// an Undo toast with the server's token.
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
const person = {
	participant: { type: "shadow", id: "p-ana" },
	name: "Ana",
	lines: [
		{ amount: { minor: 50_000, currency: "ARS" }, held: ars(50_000) },
		{ amount: { minor: -2_000, currency: "USD" }, held: ars(0) },
	],
	held: ars(50_000),
	pending: ars(0),
	lastPaidOn: null,
	ageDays: 12,
	aging: false,
} as unknown as OwedPerson;
const owed = {
	held: ars(50_000),
	pending: ars(0),
	people: [person],
	notInBudget: [],
	incomplete: false,
};

const data = {
	book: { currency: "ARS", style: "FLEX", defaultEnvelopeId: "e-else" },
	month: { key: 202610, state: "OPEN" },
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

beforeEach(() => {
	ids.counter = 0;
	toast.show.mockClear();
});

describe("owed bodies", () => {
	it("forgives only what is owed to you, in one currency, up to the balance", () => {
		expect(forgivable(person)).toHaveLength(1);
		const base = {
			id: "f1",
			person,
			currency: "ARS",
			minor: 12_050,
			envelopeId: null,
		};
		expect(forgiveBody(base)).toEqual({
			id: "f1",
			participant: { type: "shadow", id: "p-ana" },
			currency: "ARS",
			amount: "120.50",
			envelopeId: null,
		});
		expect(forgiveBody({ ...base, minor: 50_001 })).toBeNull();
		expect(forgiveBody({ ...base, minor: 50_000 })?.amount).toBe("500.00");
		expect(forgiveBody({ ...base, minor: 0 })).toBeNull();
		expect(forgiveBody({ ...base, minor: null })).toBeNull();
		// A debt you owe them is paid, not forgiven.
		expect(forgiveBody({ ...base, currency: "USD", minor: 100 })).toBeNull();
	});

	it("routes a share to a category the person picked", () => {
		expect(shareCategoryBody({ expenseId: "x1", categoryId: "c1" })).toEqual({
			transactionId: "x1",
			categoryId: "c1",
			source: "USER",
		});
		expect(shareCategoryBody({ expenseId: "x1", categoryId: null })).toBeNull();
	});
});

describe("Forgive", () => {
	it("previews the exact body, writes it once and offers the server's undo", async () => {
		const { api, calls } = fakeBudget({
			reads: { owed },
			previews: ["previewForgive"],
			writes: ["forgive"],
			undo: "undo-token-7",
		});
		session.api = api as unknown as RetrospendClient;
		const onDone = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<OwedSheet data={data} onClose={jest.fn()} onDone={onDone} visible />,
			);
		});
		press(tree, "Ana,");
		expect(disabled(tree, "Forgive")).toBe(true);
		press(tree, "1");
		press(tree, "2");
		press(tree, "0");
		press(tree, "Food,");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewForgive");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			participant: { type: "shadow", id: "p-ana" },
			currency: "ARS",
			amount: "120.00",
			envelopeId: "e-food",
		});
		press(tree, "Forgive");
		await wait(50);
		const writes = calls.filter((c) => c.route === "forgive");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toBe(
			(previews[0]?.input as { id: string } | undefined)?.id,
		);
		expect(onDone).toHaveBeenCalled();
		await undoFromToast();
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-7",
		});
		act(() => tree.unmount());
	});

	it("keeps Save off for more than the balance", async () => {
		const { api, calls } = fakeBudget({
			reads: { owed },
			previews: ["previewForgive"],
			writes: ["forgive"],
		});
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<OwedSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		press(tree, "Ana,");
		for (const k of ["9", "Three zeros"]) press(tree, k);
		await wait(400);
		expect(disabled(tree, "Forgive")).toBe(true);
		expect(calls.filter((c) => c.route === "previewForgive")).toEqual([]);
		act(() => tree.unmount());
	});
});

describe("Shares with no envelope", () => {
	it("routes a share to the picked category with a previewed, undoable write", async () => {
		const share = {
			shareId: "s1",
			expenseId: "x1",
			date: "2026-10-03",
			month: 202610,
			amount: ars(3_000),
			projectId: null,
			payer: { type: "shadow", id: "p-ana" },
		};
		const { api, calls } = fakeBudget({
			reads: {
				owed,
				unroutedShares: {
					defaultEnvelopeId: "e-else",
					shares: [share],
					total: ars(3_000),
					count: 1,
					incomplete: false,
				},
			},
			previews: ["previewSetShareCategory"],
			writes: ["setShareCategory"],
		});
		(api as unknown as { categories: unknown }).categories = {
			list: async () => ({
				items: [
					{ id: "c-food", name: "Food", icon: null, tone: 3, expenseCount: 4 },
					{ id: "c-fun", name: "Fun", icon: null, tone: 5, expenseCount: 1 },
				],
			}),
		};
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<UnroutedSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		press(tree, "Pick a category for the share of Oct 1, 2026");
		await wait(10);
		expect(disabled(tree, "Put it there")).toBe(true);
		press(tree, "Fun");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewSetShareCategory");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toEqual({
			transactionId: "x1",
			categoryId: "c-fun",
			source: "USER",
		});
		press(tree, "Put it there");
		await wait(50);
		const writes = calls.filter((c) => c.route === "setShareCategory");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		const shown = toast.show.mock.calls[0]?.[0] as { message: string };
		expect(shown.message).toBe("Share moved");
		act(() => tree.unmount());
	});
});
