import { DateQuickDays } from "./DateQuickDays";

// Today and Yesterday under a DateField: each sets its day, and the one the
// field holds reads as picked. `today` overrides the phone's day (Settle up
// counts the server's).
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) =>
		key === "today" ? "Today" : "Yesterday",
}));

function render(value: string, onChange: (day: string) => void) {
	let tree!: { root: Node };
	act(() => {
		tree = create(
			<DateQuickDays onChange={onChange} today="2026-11-04" value={value} />,
		);
	});
	return (label: string) =>
		tree.root.findAll(
			(n) =>
				n.props.accessibilityLabel === label &&
				typeof n.props.onPress === "function",
		)[0] as Node;
}

describe("DateQuickDays", () => {
	it("sets today or the day before it", () => {
		const onChange = jest.fn();
		const chip = render("2026-10-01", onChange);
		act(() => (chip("Today").props.onPress as () => void)());
		act(() => (chip("Yesterday").props.onPress as () => void)());
		expect(onChange.mock.calls).toEqual([["2026-11-04"], ["2026-11-03"]]);
	});

	it("marks the chip for the day the field holds", () => {
		const chip = render("2026-11-03", jest.fn());
		expect(chip("Yesterday").props.accessibilityState).toMatchObject({
			selected: true,
		});
		expect(chip("Today").props.accessibilityState).toMatchObject({
			selected: false,
		});
	});
});
