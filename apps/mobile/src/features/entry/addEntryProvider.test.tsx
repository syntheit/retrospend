import { Platform } from "react-native";
import { closeTransients } from "@/ui/transient";
import {
	AddEntryProvider,
	useAddButtonScroll,
	useAddEntry,
} from "./AddEntryProvider";

// Tapping Add opens the composer in Expense mode at once, with no menu in
// front of it. The kind lives in the composer's mode row; the long press on
// iOS and a deep link can still open a specific mode.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockButton: { props?: Record<string, unknown> } = {};
let mockComposer: { initialMode?: string; prefill?: unknown } | null = null;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("expo-router", () => ({ useFocusEffect: () => {} }));
jest.mock("@/layout/destinations", () => ({ ADD_CONTROL: "floating" }));
jest.mock("@/surfaces/useSurfaceLinks", () => ({ useSurfaceLinks: () => {} }));
jest.mock("./useOutboxFlush", () => ({ useOutboxFlush: () => {} }));
jest.mock("./replaceDraft", () => ({
	replaceDraft: (_dirty: boolean, go: () => void) => go(),
}));
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ children }: { children: unknown }) => children,
	useSheetBodySize: () => ({ height: 600 }),
}));
jest.mock("@/ui/AddButton", () => ({
	AddButton: (props: Record<string, unknown>) => {
		mockButton.props = props;
		return null;
	},
}));
jest.mock("./EntryComposer", () => ({
	EntryComposer: (props: { initialMode: string; prefill?: unknown }) => {
		mockComposer = props;
		return null;
	},
}));

let api: ReturnType<typeof useAddEntry> | undefined;
function Probe() {
	api = useAddEntry();
	return null;
}

function mount() {
	mockComposer = null;
	act(() => {
		create(
			<AddEntryProvider>
				<Probe />
			</AddEntryProvider>,
		);
	});
}

describe("Add button", () => {
	it("opens the composer in Expense mode on a tap", () => {
		mount();
		expect(mockComposer).toBeNull();
		act(() => (mockButton.props as { onPress: () => void }).onPress());
		expect(mockComposer?.initialMode).toBe("expense");
	});

	it("keeps Income and Transfer for the long press", () => {
		mount();
		const actions = mockButton.props?.actions as {
			id: string;
			onPress: () => void;
		}[];
		expect(actions.map((a) => a.id)).toEqual(["income", "transfer"]);
		act(() => actions[0]?.onPress());
		expect(mockComposer?.initialMode).toBe("income");
	});

	it("opens a named mode for a deep link", () => {
		mount();
		act(() => api?.open("transfer"));
		expect(mockComposer?.initialMode).toBe("transfer");
	});

	it("steps aside while a screen hides it", () => {
		mount();
		expect(mockButton.props).toBeDefined();
		mockButton.props = undefined;
		let release: (() => void) | undefined;
		act(() => {
			release = api?.hideButton();
		});
		expect(mockButton.props).toBeUndefined();
		act(() => release?.());
		expect(mockButton.props).toBeDefined();
	});
});

describe("Add button on a scrolling list (Android)", () => {
	let scroll: ((event: unknown) => void) | undefined;
	function Scroller() {
		scroll = useAddButtonScroll().onScroll as typeof scroll;
		return null;
	}
	const at = (y: number) => ({ nativeEvent: { contentOffset: { y } } });

	beforeEach(() => {
		scroll = undefined;
		jest.replaceProperty(Platform, "OS", "android");
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	function mountWithList() {
		act(() => {
			create(
				<AddEntryProvider>
					<Scroller />
				</AddEntryProvider>,
			);
		});
	}

	it("shrinks to the plus going down and extends going up", () => {
		mountWithList();
		expect(mockButton.props?.expanded).toBe(true);
		act(() => scroll?.(at(40)));
		expect(mockButton.props?.expanded).toBe(false);
		act(() => scroll?.(at(90)));
		expect(mockButton.props?.expanded).toBe(false);
		act(() => scroll?.(at(60)));
		expect(mockButton.props?.expanded).toBe(true);
	});

	it("is extended again when the tab changes", () => {
		mountWithList();
		act(() => scroll?.(at(80)));
		expect(mockButton.props?.expanded).toBe(false);
		act(() => closeTransients());
		expect(mockButton.props?.expanded).toBe(true);
	});

	it("gives a list nothing to listen to on iOS", () => {
		// Back to the test platform, which is iOS.
		jest.restoreAllMocks();
		expect(Platform.OS).toBe("ios");
		mountWithList();
		expect(scroll).toBeUndefined();
	});
});
