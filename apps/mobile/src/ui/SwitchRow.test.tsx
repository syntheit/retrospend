import { StyleSheet } from "react-native";
import { SwitchRow } from "./SwitchRow";

// Send feedback drew the label and its long detail sentence but no switch:
// the label's flex took the whole row. The detail now sits under the row, so
// the row holds only the label and the switch, and the host cannot shrink.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("./NativeHost", () => {
	const React = require("react");
	return {
		NativeHost: (props: Record<string, unknown>) =>
			React.createElement("NativeHostView", props),
	};
});
jest.mock("@expo/ui", () => {
	const React = require("react");
	return {
		Switch: (props: Record<string, unknown>) =>
			React.createElement("NativeSwitch", props),
	};
});

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	parent: Node | null;
	findAll(match: (node: Node) => boolean): Node[];
}

/** The View the host sits in: the nearest host component above it. */
function hostRow(from: Node): Node {
	let node = from.parent as Node;
	while (typeof node.type !== "string") node = node.parent as Node;
	return node;
}

const DETAIL =
	"Adds the app version, your phone model, and recent errors so a bug is easier to find.";

describe("SwitchRow", () => {
	it("draws the switch in a row of its own, with the detail under the row", () => {
		let tree!: { root: Node; unmount(): void };
		act(() => {
			tree = create(
				<SwitchRow
					detail={DETAIL}
					label="Include diagnostics"
					onChange={() => undefined}
					value={false}
				/>,
			);
		});
		const host = tree.root.findAll((n) => n.type === "NativeHostView")[0];
		const style = StyleSheet.flatten(host?.props.style as never);
		expect(style.flexShrink).toBe(0);
		expect(tree.root.findAll((n) => n.type === "NativeSwitch")).toHaveLength(1);
		const hasDetail = (n: Node) => n.props.children === DETAIL;
		const row = hostRow(host as Node);
		expect(StyleSheet.flatten(row.props.style as never).flexDirection).toBe(
			"row",
		);
		expect(row.findAll(hasDetail)).toHaveLength(0);
		expect(tree.root.findAll(hasDetail).length).toBeGreaterThan(0);
		act(() => tree.unmount());
	});

	it("lets the label column shrink so the switch keeps its place", () => {
		let tree!: { root: Node; unmount(): void };
		act(() => {
			tree = create(
				<SwitchRow label="Auto-pay" onChange={() => undefined} value={false} />,
			);
		});
		const host = tree.root.findAll((n) => n.type === "NativeHostView")[0];
		const row = hostRow(host as Node);
		const column = row.findAll(
			(n) =>
				typeof n.type === "string" &&
				StyleSheet.flatten(n.props.style as never)?.minWidth === 0,
		);
		expect(column.length).toBeGreaterThan(0);
		act(() => tree.unmount());
	});
});
