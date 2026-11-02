import { createElement } from "react";
import { CurrenciesScreen } from "./CurrenciesScreen";
import type { CurrencyRow, RateTable } from "./source";

// The Currencies screen with the server's table: rows in the server's
// order with the default price and its type, the missing-rate line, the
// search field's converter, the star and the sheet. The reads, the native
// controls and the formatter are stand-ins; the screen only lays them out.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

let mockOptions: {
	headerSearchBarOptions?: {
		onChangeText(event: { nativeEvent: { text: string } }): void;
	};
} = {};
const mockSetFavorite = jest.fn();
const mockConvert = jest.fn();
let mockTable: RateTable;

jest.mock("expo-router", () => ({
	useFocusEffect: (effect: () => void) =>
		require("react").useEffect(effect, [effect]),
	Stack: {
		Screen: ({ options }: { options: typeof mockOptions }) => {
			mockOptions = options;
			return null;
		},
	},
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: jest.fn(() => null), setItemSync: jest.fn() },
}));
jest.mock("use-intl", () => ({
	useTranslations:
		(ns: string) => (key: string, values?: Record<string, unknown>) =>
			values ? `${ns}.${key} ${JSON.stringify(values)}` : `${ns}.${key}`,
	useLocale: () => "en",
	useFormatter: () => ({ dateTime: () => "Oct 21" }),
}));
jest.mock("@/lib/money", () => ({
	useMoneyLocale: () => "en-US",
	useFormatMoney: () => ({
		format: (v: { minor: number; currency: string; places?: number }) =>
			`${v.currency}:${v.minor}`,
	}),
}));
jest.mock("@/ui/List", () => {
	const { createElement } = require("react");
	return {
		StaleNote: () => null,
		ListGroup: (props: { children: unknown }) =>
			createElement("ListGroup", null, props.children),
		ListGroupItem: (props: { children: unknown }) =>
			createElement("ListGroupItem", null, props.children),
		ListRow: (props: {
			lead: unknown;
			title: unknown;
			sub: unknown;
			end: unknown;
		}) =>
			createElement(
				"ListRow",
				null,
				props.lead,
				props.title,
				props.sub,
				props.end,
			),
	};
});
jest.mock("@/ui/Screen", () => ({
	ScreenList: (props: {
		data: unknown[];
		renderItem: (arg: { item: unknown; index: number }) => unknown;
		ListHeaderComponent: unknown;
		ListEmptyComponent: unknown;
	}) =>
		require("react").createElement(
			"Screen",
			null,
			props.ListHeaderComponent,
			props.data.length === 0
				? props.ListEmptyComponent
				: props.data.map((item, index) =>
						require("react").createElement(
							require("react").Fragment,
							{ key: index },
							props.renderItem({ item, index }),
						),
					),
		),
	Screen: (props: { children: unknown }) =>
		require("react").createElement("Screen", null, props.children),
}));
jest.mock("@/ui/Chip", () => ({
	Chip: (props: object) => require("react").createElement("Chip", props),
}));
jest.mock("./useCurrencies", () => ({
	useRateTable: () => ({
		state: { status: "ready", data: mockTable, staleSince: null },
		reload: jest.fn(),
	}),
	useFavorite: () => ({ setFavorite: mockSetFavorite, pending: false }),
	useConvert: (
		code: string | null,
		minor: number | null,
		direction: string,
	) => {
		mockConvert(code, minor, direction);
		return {
			failed: false,
			result: code
				? {
						from: { minor, currency: "BRL" },
						results: [
							{
								type: "official",
								value: { minor: 2620000, currency: "ARS" },
								derived: false,
							},
						],
					}
				: null,
		};
	},
}));
jest.mock("@/ui/RowMenu", () => ({
	RowMenu: (props: { children: unknown }) =>
		require("react").createElement("RowMenu", props, props.children),
}));
jest.mock("@/ui/Button", () => ({
	Button: (props: object) => require("react").createElement("Button", props),
}));
jest.mock("@/ui/Sheet", () => ({
	Sheet: (props: { children: unknown }) =>
		require("react").createElement("Sheet", props, props.children),
}));
jest.mock("@/ui/Glyph", () => ({
	Glyph: (props: object) => require("react").createElement("Glyph", props),
}));

const ars = (minor: number, base: string) => ({
	minor,
	currency: "ARS",
	places: 2,
	base,
});

function row(code: string, extra: Partial<CurrencyRow> = {}): CurrencyRow {
	return {
		code,
		crypto: false,
		rates: [
			{ type: "official", price: ars(141200, code), derived: false },
			{ type: "blue", price: ars(146800, code), derived: false },
		],
		defaultType: "blue",
		favorite: false,
		rateId: `${code}_blue`,
		favoriteIds: [],
		usedBy: [],
		...extra,
	};
}

const USD = row("USD", {
	favorite: true,
	favoriteIds: ["USD_blue"],
	rateId: null,
});
const BRL = row("BRL", {
	rates: [{ type: "official", price: ars(26200, "BRL"), derived: false }],
	defaultType: "official",
});
const CLP = row("CLP", {
	rates: [],
	defaultType: null,
	rateId: null,
	usedBy: ["Chile savings"],
});

interface Node {
	props: Record<string, any>;
	children: (Node | string)[];
	findAllByType(type: unknown): Node[];
}
interface Tree {
	root: Node & {
		findAll(match: (n: Node & { type: unknown }) => boolean): Node[];
	};
	toJSON(): unknown;
	unmount(): void;
}

/** Every string the tree renders. */
function texts(tree: Tree): string[] {
	const out: string[] = [];
	const walk = (node: unknown) => {
		if (typeof node === "string") out.push(node);
		else if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === "object")
			walk((node as { children?: unknown }).children ?? []);
	};
	walk(tree.toJSON());
	return out;
}

/** The star buttons, in row order. */
function stars(tree: Tree): Node[] {
	return tree.root.findAll(
		(n) =>
			typeof n.type !== "string" &&
			typeof n.props.onPress === "function" &&
			String(n.props.accessibilityLabel).includes(".star."),
	);
}

const mounted: Tree[] = [];

function mount(): Tree {
	let tree!: Tree;
	act(() => {
		tree = create(createElement(CurrenciesScreen));
	});
	mounted.push(tree);
	return tree;
}

afterEach(() => {
	for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function search(text: string) {
	act(() =>
		mockOptions.headerSearchBarOptions?.onChangeText({
			nativeEvent: { text },
		}),
	);
}

beforeEach(() => {
	mockOptions = {};
	mockSetFavorite.mockClear();
	mockConvert.mockClear();
	mockTable = {
		home: "ARS",
		columns: ["official", "blue"],
		rows: [USD, BRL, CLP],
		base: null,
		updated: "2026-10-21",
		homeDefault: "blue",
		canSetDefault: false,
	};
});

describe("CurrenciesScreen", () => {
	it("lists each currency at its default price and type, in the server's order", () => {
		const tree = mount();
		const rows = tree.root.findAllByType("RowMenu");
		expect(rows.map((r) => r.props.title)).toEqual(["USD", "BRL", "CLP"]);
		const shown = texts(tree);
		expect(shown).toContain("1,468.00 ARS");
		expect(shown).toContain("mobile.currencies.rateTypes.blue");
		expect(shown).toContain("262.00 ARS");
		// Each price is for the row's own currency, so it names no unit.
		expect(shown.some((s) => s.includes(" = "))).toBe(false);
		// No rate reads as words, never a figure.
		expect(shown).toContain("mobile.currencies.noRateSub");
		expect(shown.some((s) => s.startsWith("mobile.currencies.missing"))).toBe(
			true,
		);
		expect(shown.some((s) => s.includes("Chile savings"))).toBe(true);
	});

	it("converts what the search field reads, through the server", () => {
		const tree = mount();
		search("100 brl");
		expect(mockConvert).toHaveBeenCalledWith("BRL", 10000, "toHome");
		expect(
			tree.root.findAllByType("RowMenu").map((r) => r.props.title),
		).toEqual(["BRL"]);
		expect(texts(tree)).toContain("ARS:2620000");
	});

	it("stars a currency with a rate of its own, and not one without", () => {
		const tree = mount();
		const found = stars(tree);
		expect(found.map((s) => s.props.accessibilityState.selected)).toEqual([
			true,
			false,
			false,
		]);
		act(() => found[1]?.props.onPress());
		expect(mockSetFavorite).toHaveBeenCalledWith(BRL, true);
		mockSetFavorite.mockClear();
		// CLP has no rate row to pin.
		act(() => found[2]?.props.onPress());
		expect(mockSetFavorite).not.toHaveBeenCalled();
	});

	it("opens a currency's sheet with every rate type", () => {
		const tree = mount();
		const usd = tree.root.findAllByType("RowMenu")[0];
		act(() => usd?.props.onPress());
		const sheet = tree.root.findAllByType("Sheet")[0];
		expect(sheet?.props.title).toBe(
			'mobile.currencies.detail.title {"code":"USD"}',
		);
		const shown = texts(tree);
		expect(shown).toContain("1 USD = 1,412.00 ARS");
		expect(shown).toContain("mobile.currencies.detail.default");
	});

	it("lists the chips for favorites, fiat and crypto", () => {
		const tree = mount();
		expect(tree.root.findAllByType("Chip").map((c) => c.props.label)).toEqual([
			"mobile.currencies.filter.favorites",
			"mobile.currencies.filter.fiat",
			"mobile.currencies.filter.crypto",
		]);
	});

	it("says when no favorite is starred", () => {
		mockTable = { ...mockTable, rows: [BRL, CLP] };
		const tree = mount();
		const chip = tree.root
			.findAllByType("Chip")
			.find((c) => c.props.label === "mobile.currencies.filter.favorites");
		act(() => chip?.props.onPress());
		expect(texts(tree)).toContain("mobile.currencies.empty.noFavorites");
	});
});
