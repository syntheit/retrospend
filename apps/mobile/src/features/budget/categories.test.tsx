import type { RetrospendClient } from "@retrospend/api-client";
import { matchCategories } from "./CategoryList";
import { EditForm } from "./EditForm";
import {
	fakeBudget,
	ids,
	press,
	session,
	type Tree,
	toast,
	typeInto,
	wait,
} from "./harness";
import { createEnvelopeBody, sameIds, updateEnvelopeBody } from "./moreBodies";
import { NewEnvelopeSheet } from "./NewEnvelopeSheet";
import type { BudgetEnvelope, BudgetMonth } from "./source";

// Category pickers for new and edited envelopes: a category lives in one
// envelope, so the pick is sent as the full list, only when it changed.
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
const food = {
	id: "e-food",
	name: "Food",
	groupId: "g1",
	left: ars(1_000),
	categoryIds: ["c-food"],
} as unknown as BudgetEnvelope;
const data = {
	book: { currency: "ARS", style: "FLEX", defaultEnvelopeId: "e-else" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [{ id: "g1", name: "Spending", envelopes: [food] }],
} as unknown as BudgetMonth;

const categories = {
	list: async () => ({
		items: [
			{ id: "c-food", name: "Food", icon: null, tone: 3, expenseCount: 4 },
			{ id: "c-fun", name: "Fun", icon: null, tone: 5, expenseCount: 1 },
			{ id: "c-caf", name: "Café", icon: null, tone: 7, expenseCount: 0 },
		],
	}),
};

beforeEach(() => {
	ids.counter = 0;
	toast.show.mockClear();
});

describe("category bodies", () => {
	it("sends the picked categories when creating and none by default", () => {
		const base = { id: "i", name: "Pets", groupId: null };
		expect(createEnvelopeBody(base).categoryIds).toEqual([]);
		expect(
			createEnvelopeBody({ ...base, categoryIds: ["c1", "c2"] }).categoryIds,
		).toEqual(["c1", "c2"]);
	});

	it("sends the full list only when the set changed, whatever the order", () => {
		const base = {
			id: "i",
			envelopeId: "e",
			name: "Food",
			groupId: "g1",
			was: { name: "Food", groupId: "g1", categoryIds: ["a", "b"] },
		};
		expect(updateEnvelopeBody({ ...base, categoryIds: ["b", "a"] })).toBeNull();
		expect(updateEnvelopeBody({ ...base, categoryIds: ["a"] })).toEqual({
			id: "i",
			envelopeId: "e",
			categoryIds: ["a"],
		});
		expect(updateEnvelopeBody({ ...base })).toBeNull();
		expect(sameIds(["a", "b"], ["b", "a"])).toBe(true);
		expect(sameIds(["a"], ["a", "b"])).toBe(false);
	});

	it("finds a category ignoring case and accents", () => {
		const list = [
			{ id: "1", name: "Café", icon: null, tone: 1 },
			{ id: "2", name: "Food", icon: null, tone: 2 },
		];
		expect(matchCategories(list, "CAFE").map((c) => c.id)).toEqual(["1"]);
		expect(matchCategories(list, "").map((c) => c.id)).toEqual(["1", "2"]);
	});
});

describe("New envelope with categories", () => {
	it("previews and writes the same body with the picked categories", async () => {
		const { api, calls } = fakeBudget({
			previews: ["previewCreateEnvelope"],
			writes: ["createEnvelope"],
		});
		(api as unknown as { categories: unknown }).categories = categories;
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<NewEnvelopeSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await wait(10);
		typeInto(tree, "Name", "Eating out");
		press(tree, "Food");
		press(tree, "Fun");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewCreateEnvelope");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			name: "Eating out",
			categoryIds: ["c-food", "c-fun"],
		});
		press(tree, "Add");
		await wait(50);
		const writes = calls.filter((c) => c.route === "createEnvelope");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		act(() => tree.unmount());
	});
});

describe("Edit envelope categories", () => {
	it("sends the whole list once a category is swapped and leaves the name alone", async () => {
		const { api, calls } = fakeBudget({
			previews: ["previewUpdateEnvelope"],
			writes: ["updateEnvelope"],
		});
		(api as unknown as { categories: unknown }).categories = categories;
		session.api = api as unknown as RetrospendClient;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<EditForm
					data={data}
					envelope={food}
					month={202610}
					onClose={jest.fn()}
					onDone={jest.fn()}
				/>,
			);
		});
		await wait(10);
		// Nothing changed yet: no dry run.
		await wait(400);
		expect(calls.filter((c) => c.route === "previewUpdateEnvelope")).toEqual(
			[],
		);
		press(tree, "Food");
		press(tree, "Fun");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewUpdateEnvelope");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			envelopeId: "e-food",
			categoryIds: ["c-fun"],
		});
		expect(previews[0]?.input).not.toHaveProperty("name");
		act(() => tree.unmount());
	});
});
