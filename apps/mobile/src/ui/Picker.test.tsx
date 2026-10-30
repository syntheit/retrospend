import { PickerValueRow, WheelField } from "./Picker";

// A day of the month used to draw the wheel inline: a 200 point drum in the
// middle of the form with the label clipped. It is now a value row that opens
// the wheel in a sheet, and the pick saves once, when the sheet closes.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("./NativeHost", () => {
	const React = require("react");
	return {
		NativeHost: (props: Record<string, unknown>) =>
			React.createElement("NativeHostView", props, props.children),
	};
});
jest.mock("./Sheet", () => {
	const React = require("react");
	return {
		Sheet: (props: Record<string, unknown>) =>
			React.createElement("SheetView", props, props.children),
	};
});
jest.mock("./List", () => {
	const React = require("react");
	return {
		ListRow: (props: Record<string, unknown>) =>
			React.createElement("RowView", props, props.end),
		NavEnd: (props: Record<string, unknown>) =>
			React.createElement("NavEndView", props),
	};
});
jest.mock("./ValueMenu", () => {
	const React = require("react");
	return {
		ValueMenu: (props: Record<string, unknown>) =>
			React.createElement("ValueMenuView", props, props.children),
	};
});
jest.mock("./Chip", () => {
	const React = require("react");
	return {
		Chip: (props: Record<string, unknown>) =>
			React.createElement("ChipView", props),
	};
});
jest.mock("./Text", () => ({ Text: () => null }));
jest.mock("@expo/ui", () => {
	const React = require("react");
	const Picker = (props: Record<string, unknown>) =>
		React.createElement("NativePicker", props);
	Picker.Item = () => null;
	return { Picker };
});

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

const options = [1, 2, 3, 28].map((d) => ({
	value: String(d),
	label: String(d),
}));

function render(onChange: (value: string) => void) {
	let tree!: { root: Node; unmount(): void };
	act(() => {
		tree = create(
			<WheelField
				label="Month start"
				onChange={onChange}
				options={options}
				value="1"
			/>,
		);
	});
	return tree;
}

const kind = (tree: { root: Node }, type: string) =>
	tree.root.findAll((n) => n.type === type);

/** Calls a handler prop of the first node of a type, as the native side would. */
function fire(
	tree: { root: Node },
	type: string,
	prop: string,
	...args: unknown[]
) {
	const handler = kind(tree, type)[0]?.props[prop];
	if (typeof handler !== "function") throw new Error(`${type} has no ${prop}`);
	act(() => handler(...args));
}

describe("WheelField", () => {
	it("shows a value row and keeps the wheel in a closed sheet", () => {
		const tree = render(() => undefined);
		const row = kind(tree, "RowView")[0];
		expect(row?.props.accessibilityLabel).toBe("Month start, 1");
		expect(typeof row?.props.onPress).toBe("function");
		expect(kind(tree, "SheetView")[0]?.props.visible).toBe(false);
		act(() => tree.unmount());
	});

	it("opens the wheel on press and saves the pick once, on close", () => {
		const onChange = jest.fn();
		const tree = render(onChange);
		fire(tree, "RowView", "onPress");
		expect(kind(tree, "SheetView")[0]?.props.visible).toBe(true);
		const wheel = kind(tree, "NativePicker")[0];
		expect(wheel?.props.appearance).toBe("wheel");
		fire(tree, "NativePicker", "onValueChange", "28");
		fire(tree, "NativePicker", "onValueChange", "3");
		expect(onChange).not.toHaveBeenCalled();
		fire(tree, "SheetView", "onClose");
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith("3");
		expect(kind(tree, "SheetView")[0]?.props.visible).toBe(false);
		act(() => tree.unmount());
	});

	it("does not save when the sheet closes on the same day", () => {
		const onChange = jest.fn();
		const tree = render(onChange);
		fire(tree, "RowView", "onPress");
		fire(tree, "SheetView", "onClose");
		expect(onChange).not.toHaveBeenCalled();
		act(() => tree.unmount());
	});
});

describe("PickerValueRow (Android)", () => {
	it("shows the value with a chevron and opens the menu on press", () => {
		const onChange = jest.fn();
		let tree!: { root: Node; unmount(): void };
		act(() => {
			tree = create(
				<PickerValueRow
					label="Language"
					onChange={onChange}
					options={options}
					value="2"
				/>,
			);
		});
		const row = kind(tree, "RowView")[0];
		expect(row?.props.accessibilityLabel).toBe("Language, 2");
		expect(kind(tree, "NavEndView")[0]?.props.value).toBe("2");
		expect(kind(tree, "ValueMenuView")[0]?.props.open).toBe(false);
		fire(tree, "RowView", "onPress");
		expect(kind(tree, "ValueMenuView")[0]?.props.open).toBe(true);
		const items = kind(tree, "ValueMenuView")[0]?.props.items as {
			id: string;
			onPress: () => void;
		}[];
		expect(items.map((i) => i.id)).toEqual(["1", "2", "3", "28"]);
		items[3]?.onPress();
		expect(onChange).toHaveBeenCalledWith("28");
		act(() => tree.unmount());
	});
});
