import { FoldingKeypad, type KeypadEntry } from "./FoldingKeypad";

// The keypad folds into one Add button; open it types the amount (or a part
// that is not money), long-press on + and − adds × and ÷, and Add stays off
// until there is something to add.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({ useMoneyLocale: () => "en-US" }));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => `word:${key}`,
}));

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

function render(
	props: Partial<Parameters<typeof FoldingKeypad>[0]> & { entry: KeypadEntry },
) {
	let tree!: { root: TestNode };
	act(() => {
		tree = create(
			<FoldingKeypad
				addDescription="Add expense"
				addLabel="Add"
				addOff={false}
				busy={false}
				foldedLabel="Add expense"
				onAdd={() => {}}
				open
				{...props}
			/>,
		);
	});
	return tree;
}

const pressables = (tree: { root: TestNode }) =>
	tree.root.findAll((n) => typeof n.props.onPress === "function");
const byLabel = (tree: { root: TestNode }, label: string) =>
	tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onPress === "function",
	)[0];

const money = (text: string, onChange: (t: string) => void): KeypadEntry => ({
	text,
	currency: "USD",
	kind: "money",
	onChange,
});

describe("FoldingKeypad", () => {
	it("types digits into the amount and deletes", () => {
		const onChange = jest.fn();
		const tree = render({ entry: money("12", onChange) });
		act(() => (byLabel(tree, "5")?.props.onPress as () => void)());
		expect(onChange).toHaveBeenLastCalledWith("125");
		act(() => (byLabel(tree, "word:delete")?.props.onPress as () => void)());
		expect(onChange).toHaveBeenLastCalledWith("1");
	});

	it("adds × and ÷ on a long press of + and −", () => {
		const onChange = jest.fn();
		const tree = render({ entry: money("12", onChange) });
		const plus = byLabel(tree, "word:plusSpoken");
		act(() => (plus?.props.onPress as () => void)());
		expect(onChange).toHaveBeenLastCalledWith("12+");
		act(() =>
			(
				tree.root.findAll(
					(n) =>
						n.props.accessibilityLabel === "word:plusSpoken" &&
						typeof n.props.onLongPress === "function",
				)[0]?.props.onLongPress as () => void
			)(),
		);
		expect(onChange).toHaveBeenLastCalledWith("12×");
		act(() =>
			(
				tree.root.findAll(
					(n) =>
						n.props.accessibilityLabel === "word:minusSpoken" &&
						typeof n.props.onLongPress === "function",
				)[0]?.props.onLongPress as () => void
			)(),
		);
		expect(onChange).toHaveBeenLastCalledWith("12÷");
	});

	it("keeps Add off until there is an amount, and while busy", () => {
		const off = render({ entry: money("", () => {}), addOff: true });
		expect(byLabel(off, "Add expense")?.props.disabled).toBe(true);
		const busy = render({ entry: money("5", () => {}), busy: true });
		expect(byLabel(busy, "Add expense")?.props.disabled).toBe(true);
		const onAdd = jest.fn();
		const ready = render({ entry: money("5", () => {}), onAdd });
		act(() => (byLabel(ready, "Add expense")?.props.onPress as () => void)());
		expect(onAdd).toHaveBeenCalledTimes(1);
	});

	it("folds into the one Add button and drops every key", () => {
		const tree = render({ entry: money("5", () => {}), open: false });
		expect(pressables(tree).map((n) => n.props.accessibilityLabel)).toEqual([
			"Add expense",
		]);
	});

	it("takes whole numbers for shares and no operators or decimal key", () => {
		const onChange = jest.fn();
		const tree = render({
			entry: { text: "2", currency: "USD", kind: "units", onChange },
		});
		act(() => (byLabel(tree, "3")?.props.onPress as () => void)());
		expect(onChange).toHaveBeenLastCalledWith("23");
		expect(byLabel(tree, "word:plusSpoken")).toBeUndefined();
		expect(byLabel(tree, "word:decimal")).toBeUndefined();
	});

	it("types a percent with its decimal point", () => {
		const onChange = jest.fn();
		const tree = render({
			entry: { text: "12", currency: "USD", kind: "percent", onChange },
		});
		act(() => (byLabel(tree, "word:decimal")?.props.onPress as () => void)());
		expect(onChange).toHaveBeenLastCalledWith("12.");
	});
});
