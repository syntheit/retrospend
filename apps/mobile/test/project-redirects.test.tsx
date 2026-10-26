import { createElement } from "react";
import ProjectScreen from "../app/(tabs)/projects/[id]";
import ProjectsScreen from "../app/(tabs)/projects/index";

// Phones keep Projects inside the People tab, so the old destination's
// routes redirect there; the iPad keeps them as their own screens.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

let mockApart = false;
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
	Redirect: (props: object) =>
		require("react").createElement("Redirect", props),
	useLocalSearchParams: () => mockParams,
}));
jest.mock("use-intl", () => ({
	useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
jest.mock("@/layout/destinations", () => ({
	get PROJECTS_APART() {
		return mockApart;
	},
}));
jest.mock("@/features/account/AccountTopBar", () => ({
	AccountTopBar: () => require("react").createElement("TopBar"),
}));
jest.mock("@/features/projects/ProjectsList", () => ({
	ProjectsList: () => require("react").createElement("ProjectsList"),
}));
jest.mock("@/features/projects/ProjectView", () => ({
	ProjectView: (props: object) =>
		require("react").createElement("ProjectView", props),
}));

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

function render(screen: () => unknown) {
	let tree!: {
		root: { findAllByType(type: string): { props: Record<string, any> }[] };
		unmount(): void;
	};
	act(() => {
		tree = create(createElement(screen as never));
	});
	return tree;
}

beforeEach(() => {
	mockApart = false;
	mockParams = {};
});

describe("/projects on a phone", () => {
	it("redirects the list to the Projects segment of People", () => {
		const tree = render(ProjectsScreen);
		expect(only(tree, "Redirect").props.href).toEqual({
			pathname: "/people",
			params: { segment: "projects" },
		});
		act(() => tree.unmount());
	});

	it("redirects a project to its place inside People", () => {
		mockParams = { id: "p1" };
		const tree = render(ProjectScreen);
		expect(only(tree, "Redirect").props.href).toEqual({
			pathname: "/people/project/[id]",
			params: { id: "p1" },
		});
		act(() => tree.unmount());
	});

	it("carries the settle flag through the redirect", () => {
		mockParams = { id: "p1", settle: "1" };
		const tree = render(ProjectScreen);
		expect(only(tree, "Redirect").props.href.params).toEqual({
			id: "p1",
			settle: "1",
		});
		act(() => tree.unmount());
	});
});

describe("/projects on iPad", () => {
	it("shows the list, no redirect", () => {
		mockApart = true;
		const tree = render(ProjectsScreen);
		expect(tree.root.findAllByType("Redirect")).toHaveLength(0);
		expect(tree.root.findAllByType("ProjectsList")).toHaveLength(1);
		act(() => tree.unmount());
	});

	it("shows the project, starting to settle when asked", () => {
		mockApart = true;
		mockParams = { id: "p1", settle: "1" };
		const tree = render(ProjectScreen);
		expect(tree.root.findAllByType("Redirect")).toHaveLength(0);
		expect(only(tree, "ProjectView").props).toEqual({
			id: "p1",
			startSettling: true,
		});
		act(() => tree.unmount());
	});
});
