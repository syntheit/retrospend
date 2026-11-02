import { Dimensions, ScrollView } from "react-native";
import {
	BarScrollView,
	CollapsingBarProvider,
	useBarMetrics,
} from "./barScroll";
import { SearchPill } from "./SearchPill";
import { SearchView } from "./SearchView";

// The title line grows with the user's text size, up to the chrome cap.
const scale = Math.min(Math.max(Dimensions.get("window").fontScale, 1), 1.3);
const titleLine = Math.round(32 * 1.15 * scale);
const large = 8 + titleLine + 12;

// The pieces of Android's collapsing bar and expanded search view: the bar's
// metrics, the scroll containers that leave its band empty (and are plain
// outside it), the search bar at rest and the full screen view.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

function Metrics({
	out,
}: {
	out: { value?: ReturnType<typeof useBarMetrics> };
}) {
	out.value = useBarMetrics(52);
	return null;
}

describe("useBarMetrics", () => {
	it("stacks the status bar, the 56 row, the title band and the pinned row", () => {
		const out: { value?: ReturnType<typeof useBarMetrics> } = {};
		act(() => {
			create(<Metrics out={out} />);
		});
		const m = out.value as ReturnType<typeof useBarMetrics>;
		expect(m.inset).toBe(24);
		expect(m.row).toBe(56);
		// 32/600 at a 1.15 line height, with 8 above and 12 below.
		expect(m.titleLine).toBe(titleLine);
		expect(m.large).toBe(large);
		expect(m.collapsed).toBe(24 + 56 + 52);
		expect(m.expanded).toBe(m.collapsed + m.large);
	});
});

describe("BarScrollView", () => {
	function padding(tree: { root: Node }): unknown {
		const scroll = tree.root.findAll((n) => n.type === ScrollView)[0] as Node;
		const style = ([] as unknown[]).concat(scroll.props.contentContainerStyle);
		return style.reduce<number | undefined>(
			(top, s) =>
				s && typeof s === "object" && "paddingTop" in s
					? (s as { paddingTop: number }).paddingTop
					: top,
			undefined,
		);
	}

	it("is a plain scroll view outside a bar", () => {
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(<BarScrollView contentContainerStyle={{ padding: 16 }} />);
		});
		expect(padding(tree as { root: Node })).toBeUndefined();
	});

	it("adds the bar's band to its own top padding inside one", () => {
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(
				<CollapsingBarProvider>
					<BarScrollView contentContainerStyle={{ padding: 16 }} />
				</CollapsingBarProvider>,
			);
		});
		// The status bar, the 56 row and the title band, then its own 16.
		expect(padding(tree as { root: Node })).toBe(24 + 56 + large + 16);
	});
});

describe("SearchPill", () => {
	it("is one button named by the placeholder", () => {
		const onPress = jest.fn();
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(<SearchPill label="Search expenses" onPress={onPress} />);
		});
		const button = (tree as { root: Node }).root.findAll(
			(n) =>
				n.props.accessibilityRole === "button" &&
				typeof n.props.onPress === "function",
		)[0] as Node;
		expect(button.props.accessibilityLabel).toBe("Search expenses");
		(button.props.onPress as () => void)();
		expect(onPress).toHaveBeenCalledTimes(1);
	});
});

describe("SearchView", () => {
	function view(
		open: boolean,
		value: string,
		handlers: { onChange: jest.Mock; onClose: jest.Mock },
	) {
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(
				<SearchView
					onChange={handlers.onChange}
					onClose={handlers.onClose}
					open={open}
					placeholder="Search expenses"
					value={value}
				>
					{null}
				</SearchView>,
			);
		});
		return tree as { root: Node };
	}
	const buttons = (tree: { root: Node }) =>
		tree.root.findAll(
			(n) =>
				n.props.accessibilityRole === "button" &&
				typeof n.props.onPress === "function",
		);

	it("draws nothing while closed", () => {
		const tree = view(false, "", { onChange: jest.fn(), onClose: jest.fn() });
		expect(buttons(tree)).toHaveLength(0);
	});

	it("has a back arrow, and a clear mark only once there is text", () => {
		const handlers = { onChange: jest.fn(), onClose: jest.fn() };
		const empty = view(true, "", handlers);
		expect(buttons(empty).map((b) => b.props.accessibilityLabel)).toEqual([
			"back",
		]);
		const typed = view(true, "su", handlers);
		const marks = buttons(typed);
		expect(marks.map((b) => b.props.accessibilityLabel)).toEqual([
			"back",
			"clear",
		]);
		((marks[0] as Node).props.onPress as () => void)();
		expect(handlers.onClose).toHaveBeenCalledTimes(1);
		((marks[1] as Node).props.onPress as () => void)();
		expect(handlers.onChange).toHaveBeenCalledWith("");
	});
});
