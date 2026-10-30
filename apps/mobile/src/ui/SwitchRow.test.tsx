import { StyleSheet } from "react-native";
import { SwitchRow, switchHostStyle } from "./SwitchRow";

// Send feedback drew the label and its long detail sentence but no switch:
// the switch's host matches its contents, so it had no width of its own and
// the label's flex took the whole row. The host has to keep its room.
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
	findAll(match: (node: Node) => boolean): Node[];
}

describe("SwitchRow", () => {
	it("keeps the switch host from shrinking to nothing next to a long detail", () => {
		const { size } = require("@retrospend/tokens/theme").light;
		let tree!: { root: Node; unmount(): void };
		act(() => {
			tree = create(
				<SwitchRow
					detail="Adds the app version, your phone model, and recent errors so a bug is easier to find."
					label="Include diagnostics"
					onChange={() => undefined}
					value={false}
				/>,
			);
		});
		const host = tree.root.findAll((n) => n.type === "NativeHostView")[0];
		const style = StyleSheet.flatten(host?.props.style as never);
		expect(style.flexShrink).toBe(0);
		expect(style.minWidth).toBe(size.touchMin.phone);
		expect(style.minHeight).toBe(size.touchMin.phone);
		expect(tree.root.findAll((n) => n.type === "NativeSwitch")).toHaveLength(
			1,
		);
		act(() => tree.unmount());
	});

	it("sizes the host from the touch target token", () => {
		expect(switchHostStyle(44)).toEqual({
			flexShrink: 0,
			minWidth: 44,
			minHeight: 44,
		});
	});
});
