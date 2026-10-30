import { light } from "@retrospend/tokens/theme";
import { Text, View } from "react-native";
import { heroCents } from "@/ui/Money";
import { Avatar, AvatarStack, initialsOf, splitFaces } from "./Avatar";
import { ListGroup, ListRow, tileTint } from "./List";
import { StatusText, toneColors } from "./StatusText";

// The shared list, face and status primitives: the group draws one hairline
// between rows and none after the last, small faces show one initial, a
// stack folds the rest into +N, and a status always carries its word.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({ useFormatMoney: () => ({}) }));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => `word:${key}`,
	useFormatter: () => ({ dateTime: () => "" }),
}));

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findAllByType(type: unknown): TestNode[];
}

function render(element: React.ReactElement): TestNode {
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(element);
	});
	if (!tree) throw new Error("did not render");
	return tree.root;
}

const texts = (root: TestNode) =>
	root.findAllByType(Text).map((node) => node.props.children);

describe("initialsOf", () => {
	it("takes the first and last words, or two letters of one word", () => {
		expect(initialsOf("Lucía Fernández")).toBe("LF");
		expect(initialsOf("Ana María López")).toBe("AL");
		expect(initialsOf("paz")).toBe("PA");
		expect(initialsOf("  ")).toBe("");
	});

	it("keeps one letter when asked", () => {
		expect(initialsOf("Lucía Fernández", true)).toBe("L");
	});
});

describe("Avatar", () => {
	const face = { key: "user:1", name: "Lucía Fernández" };

	it("shows one initial at 24 and below, two above", () => {
		expect(texts(render(<Avatar face={face} size="sm" />))).toEqual(["L"]);
		expect(texts(render(<Avatar face={face} size="xs" />))).toEqual(["L"]);
		expect(texts(render(<Avatar face={face} size="default" />))).toEqual([
			"LF",
		]);
	});

	it("draws the picture when there is one", () => {
		const root = render(
			<Avatar face={{ ...face, imageUri: "https://x/a.png" }} size="row" />,
		);
		expect(texts(root)).toEqual([]);
	});
});

describe("AvatarStack", () => {
	const faces = ["Ana", "Ben", "Cleo", "Dan", "Eva"].map((name, i) => ({
		key: `user:${i}`,
		name,
	}));

	it("folds the rest into a +N chip in the last slot", () => {
		expect(splitFaces(faces, 4).shown).toHaveLength(3);
		expect(splitFaces(faces, 4).rest).toBe(2);
		expect(splitFaces(faces.slice(0, 4), 4).rest).toBe(0);
		expect(texts(render(<AvatarStack faces={faces} />))).toContain("+2");
	});

	it("puts the payer first", () => {
		const root = render(
			<AvatarStack faces={faces.slice(0, 3)} payerKey="user:2" />,
		);
		expect(texts(root)[0]).toBe("C");
	});
});

describe("ListGroup", () => {
	it("draws a hairline between rows and none after the last", () => {
		const root = render(
			<ListGroup>
				<ListRow title="One" />
				<ListRow title="Two" />
				{[<ListRow key="3" title="Three" />]}
			</ListGroup>,
		);
		const hairlines = root
			.findAllByType(View)
			.filter(
				(node) =>
					(node.props.style as { height?: number } | undefined)?.height === 1,
			);
		expect(hairlines).toHaveLength(2);
		expect(texts(root)).toEqual(["One", "Two", "Three"]);
	});

	it("renders nothing without rows", () => {
		expect(texts(render(<ListGroup>{null}</ListGroup>))).toEqual([]);
	});
});

describe("tileTint", () => {
	it("mixes the category color into the surface as an opaque color", () => {
		const tint = tileTint(light.color.category1, light.color.surface);
		expect(tint).toMatch(/^#[0-9a-f]{6}$/);
		expect(tint).not.toBe(light.color.surface);
		expect(tileTint(light.color.surface, light.color.surface)).toBe(
			light.color.surface,
		);
	});
});

describe("StatusText", () => {
	it("shows the kind's word next to the dot", () => {
		expect(texts(render(<StatusText kind="notOnRetrospend" />))).toEqual([
			"word:notOnRetrospend",
		]);
		expect(
			texts(render(<StatusText label="2 need you" tone="attention" />)),
		).toEqual(["2 need you"]);
	});

	it("uses the readable attention text, not the fill", () => {
		expect(toneColors(light.color, "attention").text).toBe(
			light.color.attentionText,
		);
	});
});

describe("heroCents", () => {
	it("drops cents only for currencies shown in whole units", () => {
		expect(heroCents("CLP")).toBe(false);
		expect(heroCents("USD")).toBe("auto");
	});
});
