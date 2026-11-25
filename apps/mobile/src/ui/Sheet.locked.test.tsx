import { BackHandler, Platform, Text } from "react-native";
import { Sheet } from "./Sheet";

// A locked sheet (a job that must not be cut off is running) cannot be
// dismissed: iOS turns off the swipe down and ignores the system's presented
// change, the close item is not drawn, and Android takes the back press and
// ignores the frame's dismissal. Unlocked, every one of those still closes it.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockFrame = {
	onIsPresentedChange: undefined as undefined | ((presented: boolean) => void),
	onDismiss: undefined as undefined | (() => void),
	modifiers: [] as unknown[],
};

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/layout/useLayoutClass", () => ({
	useLayoutClass: () => ({ tablet: false }),
}));
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));
jest.mock("@/ui/Button", () => ({ Button: () => null }));
jest.mock("@/ui/Menu", () => ({ Menu: () => null }));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("@expo/ui/swift-ui/modifiers", () => ({
	frame: () => ({ id: "frame" }),
	padding: () => ({ id: "padding" }),
	presentationBackground: () => ({ id: "background" }),
	presentationDetents: () => ({ id: "detents" }),
	presentationDragIndicator: () => ({ id: "indicator" }),
	interactiveDismissDisabled: () => ({ id: "interactiveDismissDisabled" }),
}));
jest.mock("@expo/ui/swift-ui", () => ({
	Host: ({ children }: { children: unknown }) => children,
	RNHostView: ({ children }: { children: unknown }) => children,
	Group: ({
		modifiers,
		children,
	}: {
		modifiers: unknown[];
		children: unknown;
	}) => {
		mockFrame.modifiers = modifiers;
		return children;
	},
	BottomSheet: ({
		isPresented,
		onIsPresentedChange,
		children,
	}: {
		isPresented: boolean;
		onIsPresentedChange: (p: boolean) => void;
		children: unknown;
	}) => {
		mockFrame.onIsPresentedChange = onIsPresentedChange;
		return isPresented ? children : null;
	},
}));
jest.mock("@expo/ui", () => ({
	RNHostView: ({ children }: { children: unknown }) => children,
	BottomSheet: ({
		isPresented,
		onDismiss,
		children,
	}: {
		isPresented: boolean;
		onDismiss?: () => void;
		children: unknown;
	}) => {
		mockFrame.onDismiss = onDismiss;
		return isPresented ? children : null;
	},
}));
jest.mock("@/ui/SheetFrame", () => {
	const { Platform: P } = require("react-native");
	const ios = jest.requireActual("@/ui/SheetFrame.ios");
	const android = jest.requireActual("@/ui/SheetFrame.android");
	return {
		SheetFrame: (props: Record<string, unknown>) =>
			(P.OS === "ios" ? ios : android).SheetFrame(props),
	};
});

const onClose = jest.fn();
const mount = (locked: boolean) => {
	let tree:
		| { root: { findAll(m: (n: any) => boolean): any[] }; unmount(): void }
		| undefined;
	act(() => {
		tree = create(
			<Sheet
				detents={["large"]}
				locked={locked}
				onClose={onClose}
				title="T"
				visible
			>
				<Text>body</Text>
			</Sheet>,
		);
	});
	return tree as NonNullable<typeof tree>;
};
const closeItem = (tree: ReturnType<typeof mount>) =>
	tree.root.findAll((n) => n.props.accessibilityLabel === "close");
const original = Platform.OS;

beforeEach(() => {
	onClose.mockReset();
	mockFrame.onIsPresentedChange = undefined;
	mockFrame.onDismiss = undefined;
	mockFrame.modifiers = [];
});
afterEach(() => {
	Platform.OS = original;
});

describe("Sheet locked, on iOS", () => {
	beforeEach(() => {
		Platform.OS = "ios";
	});

	it("turns the swipe down off, ignores the system's dismissal and draws no close item", () => {
		const tree = mount(true);
		expect(mockFrame.modifiers).toContainEqual({
			id: "interactiveDismissDisabled",
		});
		act(() => mockFrame.onIsPresentedChange?.(false));
		expect(onClose).not.toHaveBeenCalled();
		expect(closeItem(tree)).toHaveLength(0);
	});

	it("unlocked, the swipe, the system's dismissal and the close item all close it", () => {
		const tree = mount(false);
		expect(mockFrame.modifiers).not.toContainEqual({
			id: "interactiveDismissDisabled",
		});
		act(() => mockFrame.onIsPresentedChange?.(false));
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(closeItem(tree).length).toBeGreaterThan(0);
	});
});

describe("Sheet locked, on Android", () => {
	beforeEach(() => {
		Platform.OS = "android";
	});

	it("takes the back press and ignores the frame's dismissal", () => {
		const presses: (() => boolean)[] = [];
		const spy = jest
			.spyOn(BackHandler, "addEventListener")
			.mockImplementation((_e, handler) => {
				presses.push(handler as () => boolean);
				return { remove: () => undefined };
			});
		mount(true);
		expect(presses).toHaveLength(1);
		// true: the press is consumed, so the sheet is not closed by it.
		expect(presses[0]?.()).toBe(true);
		// The frame's own dismissal (a swipe on the M3 sheet) closes nothing.
		act(() => mockFrame.onDismiss?.());
		expect(onClose).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("unlocked, takes no back press and the frame's dismissal closes it", () => {
		const spy = jest.spyOn(BackHandler, "addEventListener");
		mount(false);
		expect(spy).not.toHaveBeenCalled();
		act(() => mockFrame.onDismiss?.());
		expect(onClose).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
