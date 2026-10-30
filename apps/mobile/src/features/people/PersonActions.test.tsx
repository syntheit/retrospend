import { PersonActions } from "./PersonActions";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

const fontScale = { current: 1 };
jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/ui/Button", () => ({
	Button: (props: Record<string, unknown>) =>
		require("react").createElement("KitButton", props),
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({
		width: 390,
		height: 844,
		scale: 3,
		fontScale: fontScale.current,
	}),
}));

const actions = [
	{ id: "settle", label: "Settle up", onPress: jest.fn(), primary: true },
	{ id: "remind", label: "Remind", onPress: jest.fn() },
	{ id: "expense", label: "Expense", onPress: jest.fn() },
];

interface Found {
	props: { style?: { flexDirection?: string } };
}

function direction(scale: number): string | undefined {
	fontScale.current = scale;
	let tree: { root: { findAll(m: (n: Found) => boolean): Found[] } } | undefined;
	act(() => {
		tree = create(<PersonActions actions={actions} />);
	});
	const row = tree?.root.findAll(
		(n) => n.props.style?.flexDirection !== undefined,
	)[0];
	return row?.props.style?.flexDirection;
}

describe("PersonActions", () => {
	it("is one row of equal columns at the default size", () => {
		expect(direction(1)).toBe("row");
	});

	it("stacks at a big text size so no label breaks a word", () => {
		expect(direction(2)).toBe("column");
	});
});
