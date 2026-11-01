import { createElement } from "react";
import { Platform } from "react-native";
import { PeopleHub } from "./PeopleHub";

// The People tab on phones, with its underline tabs: the segment follows
// the link param and the person's choice, and the search text and chip
// survive a switch. The lists and the native control are stand-ins.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

let mockParams: { segment?: string } = {};
let mockSearchOptions: {
	headerSearchBarOptions?: {
		placeholder: string;
		onChangeText(event: { nativeEvent: { text: string } }): void;
	};
} = {};
const mockSetParams = jest.fn((next: { segment?: string }) => {
	mockParams = { ...mockParams, ...next };
});

jest.mock("expo-router", () => ({
	useLocalSearchParams: () => mockParams,
	useFocusEffect: (effect: () => void) =>
		require("react").useEffect(effect, [effect]),
	router: { setParams: (next: { segment?: string }) => mockSetParams(next) },
	Stack: {
		Screen: ({ options }: { options: typeof mockSearchOptions }) => {
			mockSearchOptions = options;
			return null;
		},
	},
}));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: jest.fn(() => null), setItemSync: jest.fn() },
}));
jest.mock("use-intl", () => ({
	useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
jest.mock("@/theme", () => ({
	useTheme: () => ({ color: { bg: "bg" }, space: [0, 4, 8, 12, 16] }),
}));
jest.mock("@/features/projects/ProjectsTopBar", () => ({
	ProjectsTopBar: ({ title, search }: { title: string; search: unknown }) =>
		require("react").createElement("TopBar", { title, search }),
}));
jest.mock("./useExpensesExport", () => ({ useExpensesExport: () => [] }));
jest.mock("./PeopleTopBar", () => ({
	PeopleTopBar: ({ title, search }: { title: string; search: unknown }) =>
		require("react").createElement("TopBar", { title, search }),
}));
jest.mock("./PeopleList", () => ({
	PeopleList: (props: object) =>
		require("react").createElement(
			"PeopleList",
			props,
			(props as { top?: unknown }).top,
		),
}));
jest.mock("@/features/projects/ProjectsList", () => ({
	ProjectsList: (props: object) =>
		require("react").createElement(
			"ProjectsList",
			props,
			(props as { top?: unknown }).top,
		),
}));
jest.mock("@/ui/PaneVeil", () => ({
	markPaneSwitch: () => undefined,
	PaneVeil: () => null,
}));
jest.mock("@/ui/UnderlineTabs", () => ({
	UnderlineTabs: (props: object) =>
		require("react").createElement("UnderlineTabs", props),
}));

interface Tree {
	root: {
		findAllByType(type: string): { props: Record<string, any> }[];
	};
	update(element: unknown): void;
	unmount(): void;
}

function only(
	tree: {
		root: { findAllByType(type: string): { props: Record<string, any> }[] };
	},
	type: string,
) {
	const found = tree.root.findAllByType(type)[0];
	if (!found) throw new Error(`no ${type} in the tree`);
	return found;
}

function mount(): Tree {
	let tree!: Tree;
	act(() => {
		tree = create(createElement(PeopleHub));
	});
	return tree;
}

function rerender(tree: Tree) {
	act(() => tree.update(createElement(PeopleHub)));
}

function shown(tree: Tree): "people" | "projects" {
	return tree.root.findAllByType("PeopleList").length > 0
		? "people"
		: "projects";
}

function choose(tree: Tree, value: "people" | "projects") {
	act(() => only(tree, "UnderlineTabs").props.onChange(value));
}

beforeEach(() => {
	mockParams = {};
	mockSearchOptions = {};
	mockSetParams.mockClear();
});

describe("PeopleHub", () => {
	it("opens the segment a link names", () => {
		mockParams = { segment: "projects" };
		const tree = mount();
		expect(shown(tree)).toBe("projects");
		expect(only(tree, "TopBar").props.title).toBe("mobile.tabs.projects");
		act(() => tree.unmount());
	});

	it("opens People when nothing names a segment and none was saved", () => {
		const tree = mount();
		expect(shown(tree)).toBe("people");
		act(() => tree.unmount());
	});

	it("writes the choice back to the param, so a later link to the old segment still switches", () => {
		// People link, then the switch to Projects, then Home, then "Owed to
		// you" (a link to People again).
		mockParams = { segment: "people" };
		const tree = mount();
		choose(tree, "projects");
		expect(mockSetParams).toHaveBeenCalledWith({ segment: "projects" });
		rerender(tree);
		expect(shown(tree)).toBe("projects");

		mockParams = { segment: "people" };
		rerender(tree);
		expect(shown(tree)).toBe("people");
		act(() => tree.unmount());
	});

	it("keeps the tab row mounted above the lists on an Android phone", () => {
		jest.replaceProperty(Platform, "OS", "android");
		try {
			const tree = mount();
			const row = only(tree, "UnderlineTabs");
			// Not in the list's header, so a switch does not remount it.
			expect(only(tree, "PeopleList").props.top).toBeUndefined();
			choose(tree, "projects");
			rerender(tree);
			expect(shown(tree)).toBe("projects");
			expect(only(tree, "ProjectsList").props.top).toBeUndefined();
			expect(only(tree, "UnderlineTabs")).toBe(row);
			act(() => tree.unmount());
		} finally {
			jest.restoreAllMocks();
		}
	});

	it("keeps the tab row in each list's header on iOS", () => {
		const tree = mount();
		expect(only(tree, "PeopleList").props.top).toBeDefined();
		act(() => tree.unmount());
	});

	it("keeps the search text and the chip across a segment switch", () => {
		const tree = mount();
		act(() => only(tree, "PeopleList").props.filters.onChip("owesYou"));
		// The system's search bar is mounted by the Search icon in the top bar.
		expect(mockSearchOptions.headerSearchBarOptions).toBeUndefined();
		act(() => only(tree, "TopBar").props.search.onPress());
		act(() =>
			mockSearchOptions.headerSearchBarOptions?.onChangeText({
				nativeEvent: { text: "lu" },
			}),
		);
		expect(only(tree, "PeopleList").props.filters).toMatchObject({
			chip: "owesYou",
			query: "lu",
		});

		choose(tree, "projects");
		rerender(tree);
		expect(only(tree, "ProjectsList").props.query).toBe("lu");
		expect(mockSearchOptions.headerSearchBarOptions?.placeholder).toBe(
			"mobile.projects.search",
		);

		choose(tree, "people");
		rerender(tree);
		expect(only(tree, "PeopleList").props.filters).toMatchObject({
			chip: "owesYou",
			query: "lu",
		});
		expect(mockSearchOptions.headerSearchBarOptions?.placeholder).toBe(
			"mobile.people.search",
		);
		act(() => tree.unmount());
	});
});
