import { LONG_PRESS_MS, RowMenu } from "./RowMenu.ios";

// A long press on an iOS row sometimes opened the row instead of the context
// menu: React Native fires a Pressable's tap on release when it has no long
// press handler, so a hold let go before UIKit showed the menu fell through
// to the tap. The row now always owns its long press, with a menu or without.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@expo/ui/swift-ui", () => {
	const React = require("react");
	const part = (name: string) => (props: Record<string, unknown>) =>
		React.createElement(name, props, props.children);
	const ContextMenu = part("ContextMenu");
	(ContextMenu as unknown as Record<string, unknown>).Items = part("Items");
	(ContextMenu as unknown as Record<string, unknown>).Trigger =
		part("Trigger");
	return {
		Button: part("SButton"),
		ContextMenu,
		Group: part("Group"),
		Host: part("Host"),
		RNHostView: part("RNHostView"),
	};
});
jest.mock("@expo/ui/swift-ui/modifiers", () => ({
	contentShape: () => ({}),
	shapes: { roundedRectangle: () => ({}) },
}));

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

function row(items: { id: string; label: string; onPress: () => void }[]) {

	let tree: { root: unknown } = { root: null };
	act(() => {
		tree = create(
			<RowMenu items={items} onPress={() => undefined}>
				{null}
			</RowMenu>,
		);
	});
	return (tree.root as Node).findAll((n) => "delayLongPress" in n.props)[0].props;
}

describe("iOS RowMenu", () => {
	it("owns the long press with a menu", () => {
		const props = row([{ id: "a", label: "A", onPress: () => undefined }]);
		expect(typeof props.onLongPress).toBe("function");
		expect(props.delayLongPress).toBe(LONG_PRESS_MS);
	});

	it("owns the long press without a menu", () => {
		const props = row([]);
		expect(typeof props.onLongPress).toBe("function");
		expect(props.delayLongPress).toBe(LONG_PRESS_MS);
	});
});
