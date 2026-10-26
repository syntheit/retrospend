import { createElement } from "react";
import { PeopleHub } from "./PeopleHub";

// The People tab on phones, with its segmented control: the segment follows
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
jest.mock("@/features/account/AccountTopBar", () => ({
	AccountTopBar: ({ title }: { title: string }) =>
		require("react").createElement("TopBar", { title }),
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
jest.mock("@/ui/Segmented", () => ({
	Segmented: (props: object) =>
		require("react").createElement("Segmented", props),
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
	act(() => only(tree, "Segmented").props.onChange(value));
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

	it("keeps the search text and the chip across a segment switch", () => {
		const tree = mount();
		act(() => only(tree, "PeopleList").props.filters.onChip("owesYou"));
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
