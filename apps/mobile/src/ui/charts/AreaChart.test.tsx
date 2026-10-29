import { light } from "@retrospend/tokens/theme";
import { AreaChart, type AreaPoint } from "./AreaChart";

// The chart reads its spoken summary from the server's first and last known
// values, steps day by day for a screen reader, and draws the fill at the
// spec's opacity in token colors.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock(
	"@/auth/session",
	() => require("@/features/budget/harness").sessionMock,
);
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => require("@/features/budget/harness").intlMock);
jest.mock("react-native-gesture-handler", () => {
	const chain: Record<string, unknown> = {};
	for (const name of [
		"runOnJS",
		"activateAfterLongPress",
		"onStart",
		"onUpdate",
		"onFinalize",
	])
		chain[name] = () => chain;
	return {
		Gesture: { Pan: () => chain },
		GestureDetector: ({ children }: { children: unknown }) => children,
	};
});

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

const ars = (minor: number) => ({ minor, currency: "ARS" });
const points: AreaPoint[] = [
	{ date: "2026-10-01", value: ars(100_00) },
	{ date: "2026-10-02", value: null },
	{ date: "2026-10-03", value: ars(250_00) },
	{ date: "2026-10-04", value: ars(300_00) },
];

function render(onScrub: (p: AreaPoint | null) => void) {
	let tree: { root: Node } | undefined;
	act(() => {
		tree = create(
			<AreaChart label="Net worth, 1M" onScrub={onScrub} points={points} />,
		);
	});
	const root = (tree as { root: Node }).root;
	const chart = root.findAll(
		(n) => n.props.accessibilityRole === "adjustable",
	)[0] as Node;
	act(() => {
		(chart.props.onLayout as (e: unknown) => void)({
			nativeEvent: { layout: { width: 300 } },
		});
	});
	return { root, chart };
}

describe("AreaChart", () => {
	it("says what it shows from the first to the last known day", () => {
		const { chart } = render(() => {});
		expect(chart.props.accessibilityLabel).toMatch(/^Net worth, 1M\. From /);
		expect(chart.props.accessibilityLabel).toContain("300");
	});

	it("steps day by day for a screen reader and reports the day", () => {
		const onScrub = jest.fn();
		const { root } = render(onScrub);
		const act1 = (name: string) => {
			const chart = root.findAll(
				(n) => n.props.accessibilityRole === "adjustable",
			)[0] as Node;
			act(() => {
				(chart.props.onAccessibilityAction as (e: unknown) => void)({
					nativeEvent: { actionName: name },
				});
			});
		};
		act1("decrement");
		expect(onScrub).toHaveBeenLastCalledWith(points[2]);
		act1("decrement");
		// A gap is a real day with no value, never zero.
		expect(onScrub).toHaveBeenLastCalledWith(points[1]);
	});

	it("fills the area at 16% of the accent", () => {
		const { root } = render(() => {});
		const fills = root.findAll((n) => n.props.fillOpacity !== undefined);
		expect(fills[0]?.props.fill).toBe(light.color.accent);
		expect(fills[0]?.props.fillOpacity).toBe(0.16);
	});
});
