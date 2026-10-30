import { StyleSheet } from "react-native";
import { SwitchRow, switchHostStyle } from "./SwitchRow";

// Send feedback drew the label and its long detail sentence but no switch:
// the switch's host matched its contents, so it had no width until the native
// control reported one and the label's flex took the whole row. The host is a
// fixed box that keeps its room from the first frame.
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
		expect(host?.props.matchContents).toBe(false);
		expect(style.flexShrink).toBe(0);
		expect(style.width).toBeGreaterThanOrEqual(size.touchMin.phone);
		expect(style.height).toBeGreaterThan(0);
		expect(tree.root.findAll((n) => n.type === "NativeSwitch")).toHaveLength(
			1,
		);
		act(() => tree.unmount());
	});

	it("gives the host a width and a height without waiting for the control", () => {
		const style = switchHostStyle();
		expect(style.flexShrink).toBe(0);
		expect(style.width).toBeGreaterThan(0);
		expect(style.height).toBeGreaterThan(0);
	});
});
