import { BudgetNotice } from "./BudgetNotice";
import { GroupList } from "./GroupSection";
import type { Tree } from "./harness";
import type { BudgetGroup, BudgetMonth } from "./source";

// The page's list: Flex folds each group into one bucket row in one list, a
// tap opens the envelopes under it, an over envelope is a pill with its
// amount, and the notice carries one secondary button.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/auth/session", () => require("./harness").sessionMock);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("./harness").intlMock);
jest.mock("@/ui/Button", () => require("./harness").buttonMock);
jest.mock("@/ui/SwipeRow", () => ({
	SwipeRow: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/ui/RowMenu", () => ({
	RowMenu: ({ children }: { children: unknown }) => children,
}));

const ars = (minor: number) => ({ minor, currency: "ARS" });
const totals = (over: Partial<BudgetGroup["totals"]> = {}) =>
	({
		carryIn: ars(0),
		assigned: ars(100_000),
		activity: ars(0),
		spent: ars(25_000),
		left: ars(75_000),
		over: ars(0),
		limitLeft: null,
		need: ars(0),
		count: 2,
		...over,
	}) as BudgetGroup["totals"];
const envelope = (id: string, name: string, over = {}) => ({
	id,
	name,
	icon: null,
	color: null,
	status: "FUNDED",
	assigned: ars(0),
	spent: ars(0),
	spentBasis: 2500,
	left: ars(1_000),
	target: null,
	leftThisWeek: null,
	...over,
});
const groups = [
	{
		id: "g-bills",
		name: null,
		role: "BILLS",
		totals: totals(),
		target: null,
		envelopes: [envelope("e-rent", "Rent")],
	},
	{
		id: "g-spend",
		name: null,
		role: "SPENDING",
		totals: totals({ over: ars(4_000), left: ars(-4_000) }),
		target: null,
		envelopes: [
			envelope("e-cafe", "Cafe", { status: "OVERSPENT", left: ars(-4_000) }),
		],
	},
] as unknown as BudgetGroup[];

function render(element: React.ReactElement): Tree {
	let tree: Tree | undefined;
	act(() => {
		tree = create(element);
	});
	return tree as Tree;
}

const labels = (tree: Tree) =>
	tree.root
		.findAll((n) => typeof n.props.accessibilityLabel === "string")
		.map((n) => n.props.accessibilityLabel as string);

describe("Flex buckets", () => {
	it("folds each group to one row that says what it holds, and opens on a tap", () => {
		const tree = render(
			<GroupList
				groups={groups}
				kind="open"
				onOpenEnvelope={() => undefined}
				style="FLEX"
				wide={false}
			/>,
		);
		const before = labels(tree);
		expect(before.some((l) => l.startsWith("Bills, "))).toBe(true);
		expect(before.some((l) => l.startsWith("Spending, "))).toBe(true);
		// Folded: no envelope row yet.
		expect(before.some((l) => l.startsWith("Rent"))).toBe(false);

		const bucket = tree.root.findAll(
			(n) =>
				typeof n.props.accessibilityLabel === "string" &&
				(n.props.accessibilityLabel as string).startsWith("Bills, ") &&
				typeof n.props.onPress === "function",
		)[0];
		act(() => {
			(bucket as { props: { onPress: () => void } }).props.onPress();
		});
		const after = labels(tree);
		expect(after.some((l) => l.startsWith("Rent"))).toBe(true);
	});

	it("names the over envelope on the group's line and puts the amount in a pill", () => {
		const tree = render(
			<GroupList
				groups={groups}
				kind="open"
				onOpenEnvelope={() => undefined}
				style="FLEX"
				wide={false}
			/>,
		);
		const spoken = labels(tree).find((l) => l.startsWith("Spending, "));
		expect(spoken).toContain("Over:");
		const texts = tree.root
			.findAll((n) => n.type === "Text")
			.map((n) => JSON.stringify(n.props.children));
		expect(texts.some((t) => t.includes("Cafe over by"))).toBe(true);
		expect(texts.some((t) => t.includes("Over by"))).toBe(true);
	});
});

describe("Groups that start open", () => {
	it("shows the envelopes under a header with the group's Left and no count", () => {
		const tree = render(
			<GroupList
				groups={groups}
				kind="open"
				onOpenEnvelope={() => undefined}
				style="EVERY_DOLLAR"
				wide={false}
			/>,
		);
		const all = labels(tree);
		expect(all.some((l) => l.startsWith("Rent"))).toBe(true);
		expect(all.some((l) => l.startsWith("Cafe, No target, Over by"))).toBe(
			true,
		);
		const texts = tree.root
			.findAll((n) => n.type === "Text")
			.map((n) => JSON.stringify(n.props.children));
		expect(texts.some((t) => t.includes("2 envelopes"))).toBe(false);
	});
});

describe("Notice", () => {
	const data = (notice: object, action: string | null) =>
		({
			verdict: { notice, action },
			groups,
		}) as unknown as BudgetMonth;

	it("offers Use my plan beside unplanned money, in the info tone", () => {
		const ran: string[] = [];
		const tree = render(
			<BudgetNotice
				canAct
				data={data(
					{ kind: "NOT_PLANNED_YET", amount: ars(85_000), action: "USE_PLAN" },
					null,
				)}
				onCover={() => ran.push("cover")}
				onUsePlan={() => ran.push("plan")}
			/>,
		);
		const button = tree.root.findAll(
			(n) =>
				n.props.accessibilityLabel === "Use my plan" &&
				typeof n.props.onPress === "function",
		)[0];
		act(() => {
			(button as { props: { onPress: () => void } }).props.onPress();
		});
		expect(ran).toEqual(["plan"]);
	});

	it("stays quiet when the hero already has the same button", () => {
		const tree = render(
			<BudgetNotice
				canAct
				data={data(
					{ kind: "OVERSPENT", amount: ars(4_000), action: "COVER" },
					"COVER",
				)}
				onCover={() => undefined}
				onUsePlan={() => undefined}
			/>,
		);
		expect(tree.root.findAll((n) => n.type === "View")).toHaveLength(0);
	});
});
