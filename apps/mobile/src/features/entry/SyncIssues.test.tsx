import { SyncIssues } from "./SyncIssues";

// Screen readers skip what sits inside an `accessible` view, so Try again and
// Discard must not be wrapped in one with the entry's words.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	parent: TestNode | null;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

jest.mock("./parked", () => ({
	useParkedEntries: () => ({
		entries: [
			{
				clientId: "c1",
				title: "Coffee",
				amount: { minor: 350000, currency: "ARS" },
			},
		],
		retry: jest.fn(),
		discard: jest.fn(),
	}),
}));
jest.mock("@/lib/money", () => ({
	useFormatMoney: () => ({ format: () => "ARS 3,500.00" }),
}));
jest.mock("@/ui/Toast", () => ({
	useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

function insideAccessible(node: TestNode): boolean {
	for (let up = node.parent; up; up = up.parent) {
		if (up.props.accessible === true) return true;
	}
	return false;
}

it("keeps Try again and Discard reachable by a screen reader", async () => {
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(<SyncIssues />);
	});
	const buttons = tree.root.findAll(
		(n) =>
			n.props.accessibilityRole === "button" &&
			typeof n.props.onPress === "function" &&
			typeof n.props.accessibilityLabel === "string",
	);
	const labels = [...new Set(buttons.map((b) => b.props.accessibilityLabel))];
	expect(labels).toEqual(["sync.retry, Coffee", "sync.discard, Coffee"]);
	for (const button of buttons) expect(insideAccessible(button)).toBe(false);
	// The entry's words are still one stop.
	expect(
		tree.root.findAll((n) => n.props.accessible === true).length,
	).toBeGreaterThan(0);
	act(() => tree.unmount());
});
