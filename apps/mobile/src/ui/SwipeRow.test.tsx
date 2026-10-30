import { Text } from "react-native";
import { SWIPE_FAIL_Y, SWIPE_START, SwipeRow } from "./SwipeRow";
import { closeTransients } from "./transient";

// A swipe starts only on a clearly sideways drag and yields to the list's
// vertical scroll; the actions are not drawn under a row at rest (a selected
// row's tint never shows them); an open row closes on a tab switch.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

interface PanConfig {
	enabled: boolean;
	activeOffsetX: [number, number];
	failOffsetY: [number, number];
	onActivate: () => void;
	onUpdate: (event: { translationX: number }) => void;
	onDeactivate: (event: { velocityX: number }) => void;
}

let pan: PanConfig | null = null;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: unknown }) => children,
	usePanGesture: (config: PanConfig) => {
		pan = config;
		return {};
	},
}));
jest.mock("./List", () => ({ useInGroup: () => false }));
jest.mock("./RowMenu", () => ({
	RowMenu: ({ children }: { children: unknown }) => children,
}));

function render(onPress = jest.fn()) {
	let tree!: { root: Node };
	act(() => {
		tree = create(
			<SwipeRow
				leading={{ label: "Split", onPress: jest.fn(), tone: "brand" }}
				menu={[]}
				onPress={onPress}
				trailing={{ label: "Delete", onPress: jest.fn(), tone: "danger" }}
			>
				<Text>Coffee</Text>
			</SwipeRow>,
		);
	});
	return tree.root;
}

const texts = (root: Node) =>
	root
		.findAll((n) => typeof n.props.children === "string")
		.map((n) => n.props.children);

const closer = (root: Node) =>
	root.findAll(
		(n) =>
			n.props.accessibilityElementsHidden === true &&
			typeof n.props.onPress === "function",
	);

describe("SwipeRow", () => {
	it("starts only on a sideways drag and fails on a vertical one", () => {
		render();
		const config = pan as PanConfig;
		expect(config.enabled).toBe(true);
		expect(config.activeOffsetX).toEqual([-SWIPE_START, SWIPE_START]);
		expect(config.failOffsetY).toEqual([-SWIPE_FAIL_Y, SWIPE_FAIL_Y]);
		// Steeper than about 27 degrees off horizontal is the scroll's.
		expect(SWIPE_FAIL_Y / SWIPE_START).toBeLessThanOrEqual(0.5);
	});

	it("draws no actions under a row at rest", () => {
		const root = render();
		expect(texts(root)).toContain("Coffee");
		expect(texts(root)).not.toContain("Delete");
		expect(texts(root)).not.toContain("Split");
	});

	it("opens on a far enough drag and closes on a tab switch", () => {
		const root = render();
		const config = pan as PanConfig;
		act(() => {
			config.onActivate();
			config.onUpdate({ translationX: -(SWIPE_START + 80) });
			config.onDeactivate({ velocityX: 0 });
		});
		// While open, a tap on the row only closes it.
		expect(closer(root)).toHaveLength(1);
		act(() => closeTransients());
		expect(closer(root)).toHaveLength(0);
	});

	it("settles back on a short drag", () => {
		const root = render();
		const config = pan as PanConfig;
		act(() => {
			config.onActivate();
			config.onUpdate({ translationX: SWIPE_START + 20 });
			config.onDeactivate({ velocityX: 0 });
		});
		expect(closer(root)).toHaveLength(0);
	});
});
