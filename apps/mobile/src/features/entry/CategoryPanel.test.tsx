import { CategoryPanel } from "./CategoryPanel";
import type { EntryCatalog, EntryCategory } from "./types";

// The category panel: the six most used as pills, the picked one always on
// screen, and a More pill for the rest.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useLocale: () => "en",
	useTranslations: () => (key: string) => key,
}));
jest.mock("@/ui/Glyph", () => ({
	Glyph: () => null,
	CategoryGlyph: () => null,
	categoryColor: () => "#000000",
}));
let mockRoom: number | null = null;
jest.mock("@/ui/DetailPager", () => ({ usePanelRoom: () => mockRoom }));
jest.mock("@/ui/CategoryPickerSheet", () => ({
	CategoryPickerSheet: ({
		visible,
		top,
	}: {
		visible: boolean;
		top: { id: string }[];
	}) => (visible ? `picker:${top.length}` : null),
}));

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const names = [
	"Groceries",
	"Cafe",
	"Transport",
	"Rent",
	"Health",
	"Clothing",
	"Gifts",
	"Taxes",
	"Pets",
];
const categories: EntryCategory[] = names.map((name, i) => ({
	id: name.toLowerCase(),
	name,
	icon: null,
	tone: 1,
	excludeByDefault: false,
	// Groceries is used the most, Pets the least.
	uses: 100 - i * 10,
}));
const catalog = { categories } as unknown as EntryCatalog;

function render(categoryId: string | null) {
	let tree!: { root: TestNode };
	act(() => {
		tree = create(
			<CategoryPanel
				catalog={catalog}
				draft={{ categoryId, editing: null }}
				error={false}
				onPick={jest.fn()}
			/>,
		);
	});
	return tree.root;
}

// A pill's label sits on the pill and on the chip inside it: each word once.
const labels = (root: TestNode) => [
	...new Set(
		root
			.findAll((n) => typeof n.props.label === "string")
			.map((n) => n.props.label as string),
	),
];

describe("CategoryPanel", () => {
	it("shows the six most used and a More pill", () => {
		const shown = labels(render(null));
		expect(shown.filter((l) => names.includes(l))).toEqual(names.slice(0, 6));
		expect(shown).toContain("categoriesMore");
		expect(shown).not.toContain("Pets");
	});

	it("keeps a picked category that is not a top one on screen", () => {
		const shown = labels(render("pets"));
		expect(shown).toContain("Pets");
		expect(shown.filter((l) => names.includes(l))).toHaveLength(6);
	});

	it("opens the full list from More", () => {
		const root = render(null);
		const more = root.findAll((n) => n.props.label === "categoriesMore")[0];
		const press = (more as TestNode).props.onPress as () => void;
		act(() => {
			press();
		});
		// The sheet gets the pills on screen as its first group.
		const sheet = root.findAll((n) => n.props.visible === true)[0];
		expect(sheet).toBeDefined();
		expect((sheet as TestNode).props.top).toHaveLength(6);
	});

	it("drops pills until the rows fit the panel, keeping More", () => {
		mockRoom = 100;
		let tree!: { root: TestNode };
		act(() => {
			tree = create(
				<CategoryPanel
					catalog={catalog}
					draft={{ categoryId: null, editing: null }}
					error={false}
					onPick={jest.fn()}
				/>,
			);
		});
		const wrap = tree.root.findAll(
			(n) =>
				Boolean(n.props.accessibilityLabel === "category" && n.props.onLayout),
		)[0] as TestNode;
		const onLayout = wrap.props.onLayout as (e: object) => void;
		// Too tall for the room: one pill goes each time, then it settles.
		for (let i = 0; i < 3; i++) {
			act(() => onLayout({ nativeEvent: { layout: { height: 140 } } }));
		}
		const after = labels(tree.root);
		expect(after.filter((l) => names.includes(l))).toHaveLength(3);
		expect(after).toContain("categoriesMore");
		act(() => onLayout({ nativeEvent: { layout: { height: 90 } } }));
		expect(labels(tree.root).filter((l) => names.includes(l))).toHaveLength(3);
		mockRoom = null;
	});
});
