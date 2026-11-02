import { light } from "@retrospend/tokens/theme";
import { DetailActions } from "./DetailActions";
import { GLYPHS } from "./glyphs.generated";
import { MENU_SYMBOL } from "./menuIcons";

const renderer = require("react-test-renderer");
const { act, create } = renderer;

function render(element: unknown): Tree {
	let tree: Tree | undefined;
	act(() => {
		tree = create(element);
	});
	return tree as Tree;
}

jest.mock("@/theme", () => ({ useTheme: () => require("@retrospend/tokens/theme").light }));
jest.mock("./TopBarAction", () => ({
	TopBarAction: (props: Record<string, unknown>) =>
		require("react").createElement("EditButton", props),
}));
jest.mock("./Menu", () => ({
	Menu: (props: Record<string, unknown>) =>
		require("react").createElement("OverflowMenu", props),
}));

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
}
interface Tree {
	root: { findAll(match: (node: TestNode) => boolean): TestNode[] };
}

function kinds(tree: Tree): string[] {
	return tree.root
		.findAll((n) => n.type === "EditButton" || n.type === "OverflowMenu")
		.map((n) => String(n.type));
}

describe("DetailActions", () => {
	const items = [
		{ id: "a", label: "Make recurring", icon: "Repeat" as const, onPress: jest.fn() },
		{
			id: "d",
			label: "Delete",
			icon: "Trash2" as const,
			destructive: true,
			onPress: jest.fn(),
		},
	];

	it("puts the pencil first and the menu at the far end, both labeled", () => {
		const tree = render(
			<DetailActions
				edit={() => undefined}
				editLabel="Edit"
				items={items}
				moreLabel="More actions"
			/>,
		);
		expect(kinds(tree)).toEqual(["EditButton", "OverflowMenu"]);
		const [pencil, menu] = tree.root.findAll(
			(n) => n.type === "EditButton" || n.type === "OverflowMenu",
		);
		expect(pencil?.props.label).toBe("Edit");
		expect(menu?.props.accessibilityLabel).toBe("More actions");
		expect(menu?.props.icon).toBe(true);
	});

	it("leaves out what has nothing behind it", () => {
		const noEdit = render(
			<DetailActions
				edit={null}
				editLabel="Edit"
				items={items}
				moreLabel="More actions"
			/>,
		);
		expect(kinds(noEdit)).toEqual(["OverflowMenu"]);
		const noMenu = render(
			<DetailActions
				edit={() => undefined}
				editLabel="Edit"
				items={[]}
				moreLabel="More actions"
			/>,
		);
		expect(kinds(noMenu)).toEqual(["EditButton"]);
	});
});

describe("menu icons", () => {
	it("draws every menu glyph", () => {
		for (const name of Object.keys(MENU_SYMBOL)) {
			expect(GLYPHS[name]?.length).toBeGreaterThan(0);
		}
		expect(GLYPHS.EllipsisVertical?.length).toBeGreaterThan(0);
		expect(light).toBeDefined();
	});
});
