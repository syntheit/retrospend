import { StyleSheet } from "react-native";
import { Chip, ChipGroup } from "./Chip";

// A trigger whose value is set and can be cleared (a set period) reads as
// set: brand-soft with a brand border and an x in place of the chevron. A
// trigger without a clear keeps the neutral look whatever it shows.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

const { color } = require("@retrospend/tokens/theme").light;

function chip(props: Partial<Parameters<typeof Chip>[0]>) {
	let tree!: { root: Node };
	act(() => {
		tree = create(
			<Chip
				label="This month"
				onPress={() => {}}
				variant="trigger"
				{...props}
			/>,
		);
	});
	const outer = tree.root.findAll(
		(n) => n.props.accessibilityLabel === "This month" && !!n.props.style,
	)[0] as Node;
	const style = StyleSheet.flatten(
		typeof outer.props.style === "function"
			? (outer.props.style as (s: { pressed: boolean }) => object)({
					pressed: false,
				})
			: (outer.props.style as object),
	) as Record<string, unknown>;
	const clear = tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === "Clear period" &&
			typeof n.props.onPress === "function",
	);
	return { style, clear, state: outer.props.accessibilityState };
}

describe("trigger chip", () => {
	it("reads as set with a clear mark when its value can be cleared", () => {
		const onClear = jest.fn();
		const { style, clear, state } = chip({
			selected: true,
			onClear,
			clearLabel: "Clear period",
		});
		expect(style.backgroundColor).toBe(color.brandSoft);
		expect(style.borderColor).toBe(color.brand);
		expect(state).toEqual({ selected: true });
		expect(clear).toHaveLength(1);
		act(() => ((clear[0] as Node).props.onPress as () => void)());
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("keeps the neutral look without a clear", () => {
		const { style, clear } = chip({ selected: true });
		expect(style.backgroundColor).toBe(color.surface);
		expect(style.borderColor).toBe(color.lineStrong);
		expect(clear).toHaveLength(0);
	});
});

describe("chip group", () => {
	it("is a radio group with the picked option on, and picking calls back", () => {
		const onChange = jest.fn();
		let tree!: { root: Node };
		act(() => {
			tree = create(
				<ChipGroup
					accessibilityLabel="Repeats"
					onChange={onChange}
					options={[
						{ value: "a", label: "Weekly" },
						{ value: "b", label: "Monthly" },
					]}
					value="b"
				/>,
			);
		});
		expect(
			tree.root.findAll((n) => n.props.accessibilityRole === "radiogroup")
				.length,
		).toBeGreaterThan(0);
		const named = (label: string) =>
			tree.root.findAll((n) => n.props.accessibilityLabel === label)[0] as Node;
		expect(named("Weekly").props.accessibilityState).toEqual({
			selected: false,
		});
		expect(named("Monthly").props.accessibilityState).toEqual({
			selected: true,
		});
		act(() => (named("Weekly").props.onPress as () => void)());
		expect(onChange).toHaveBeenCalledWith("a");
	});
});
