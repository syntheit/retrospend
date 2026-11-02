import { CurrencyPicker } from "./CurrencyPicker";
import { filterGroups, type PickGroup } from "./pickGroups";

// The currency picker: a pill trigger (flag, code, chevron) and a sheet of
// Pinned, Your currencies, Recent, Fiat and Crypto, searchable by code, name
// and country with the best match first.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useLocale: () => "es",
	useTranslations: () => (key: string, values?: { code?: string }) =>
		values?.code ? `${key}:${values.code}` : key,
}));
jest.mock("react-native-svg", () => ({
	parse: () => ({}),
	SvgAst: () => null,
}));
jest.mock("./Glyph", () => ({ Glyph: () => null }));
const mockPins = jest.fn((): string[] => []);
jest.mock("@/features/currencies/useCurrencies", () => ({
	usePinnedCurrencies: () => mockPins(),
}));
const mockSecure = new Map<string, string>();
jest.mock("@/lib/secure-store", () => ({
	secureStore: {
		getItem: (key: string) => mockSecure.get(key) ?? null,
		setItemAsync: async (key: string, value: string) => {
			mockSecure.set(key, value);
		},
	},
}));
let sheet: {
	groups: PickGroup[];
	title: string;
	visible: boolean;
	onSelect(id: string): void;
	onClose(): void;
};
jest.mock("./PickerSheet", () => ({
	PickerSheet: (props: typeof sheet) => {
		sheet = props;
		return null;
	},
}));

import { resetRecentCurrencies } from "@/lib/recent-currencies";

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const CURRENCIES = ["USD", "EUR", "ARS", "BRL", "JPY", "BTC", "ETH"];

function mount(
	props: Partial<React.ComponentProps<typeof CurrencyPicker>> = {},
) {
	const onChange = jest.fn();
	let tree: { root: TestNode };
	act(() => {
		tree = create(
			<CurrencyPicker
				currencies={CURRENCIES}
				onChange={onChange}
				value="ARS"
				yours={["USD"]}
				{...props}
			/>,
		);
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned inside act above
	return { root: tree!.root, onChange };
}

/** Presses the trigger: the sheet builds its rows on the first open. */
function open(root: TestNode) {
	const pill = root.findAll(
		(n) =>
			typeof n.props.accessibilityLabel === "string" &&
			n.props.accessibilityRole === "button",
	)[0];
	const press = pill?.props.onPress as () => void;
	act(() => press());
}

const ids = (groups: PickGroup[]) =>
	groups.flatMap((g) => g.rows.map((r) => r.id));

beforeEach(() => {
	mockPins.mockReturnValue([]);
	mockSecure.clear();
	resetRecentCurrencies();
});

describe("CurrencyPicker", () => {
	it("is a pill that says the currency and opens the sheet", () => {
		const { root } = mount();
		const pill = root.findAll(
			(n) =>
				n.props.accessibilityLabel === "currency.trigger:ARS" &&
				n.props.accessibilityRole === "button",
		)[0];
		expect(pill?.props.accessibilityRole).toBe("button");
		expect(sheet.visible).toBe(false);
		const press = pill?.props.onPress as () => void;
		act(() => press());
		expect(sheet.visible).toBe(true);
	});

	it("speaks what is being chosen before the code", () => {
		const { root } = mount({ label: "Home currency" });
		expect(
			root.findAll((n) => n.props.accessibilityLabel === "Home currency, ARS"),
		).not.toHaveLength(0);
		expect(sheet.title).toBe("Home currency");
	});

	it("builds the rows only when the sheet is first opened", () => {
		const { root } = mount();
		expect(sheet.groups.flatMap((g) => g.rows)).toEqual([]);
		open(root);
		expect(ids(sheet.groups)).toContain("ARS");
		// Closing keeps them for the closing animation.
		act(() => sheet.onClose());
		expect(ids(sheet.groups)).toContain("ARS");
	});

	it("lists pinned first, then yours, recent, fiat and crypto", () => {
		mockPins.mockReturnValue(["JPY", "BTC"]);
		open(mount({ recent: ["EUR"] }).root);
		expect(sheet.groups.map((g) => g.key)).toEqual([
			"pinned",
			"yours",
			"recent",
			"fiat",
			"crypto",
		]);
		expect(sheet.groups.map((g) => g.rows.map((r) => r.id))).toEqual([
			["JPY", "BTC"],
			["USD"],
			["EUR"],
			["ARS", "BRL"],
			["ETH"],
		]);
	});

	it("shows each row as code and name in the app language, the current one selected", () => {
		open(mount().root);
		const rows = sheet.groups.flatMap((g) => g.rows);
		const ars = rows.find((r) => r.id === "ARS");
		expect(ars).toMatchObject({
			label: "ARS",
			detail: "peso argentino",
			selected: true,
		});
		expect(rows.find((r) => r.id === "USD")?.selected).toBe(false);
	});

	it("finds a currency by code, by name in either language or by country", () => {
		open(mount().root);
		const find = (q: string) => ids(filterGroups(sheet.groups, q));
		expect(find("brl")).toEqual(["BRL"]);
		expect(find("brasileño")).toEqual(["BRL"]);
		expect(find("brazilian")).toEqual(["BRL"]);
		// The country, in Spanish and in English.
		expect(find("japón")).toEqual(["JPY"]);
		expect(find("japan")).toEqual(["JPY"]);
		expect(find("bitcoin")).toEqual(["BTC"]);
	});

	it("puts the exact code, then a code prefix, before name matches", () => {
		open(mount().root);
		// "eu" is the start of EUR, and a word in no other name.
		expect(ids(filterGroups(sheet.groups, "eu"))[0]).toBe("EUR");
		// "r": BRL has a name starting with it ("real"), EUR and ARS only hold
		// an r, so BRL leads the fiat section against the list's order.
		const fiat = filterGroups(sheet.groups, "r").find((g) => g.key === "fiat");
		expect(fiat?.rows.map((r) => r.id)).toEqual(["BRL", "EUR", "ARS"]);
	});

	it("remembers a pick as recent, newest first, and reports it", () => {
		const { onChange } = mount();
		act(() => sheet.onSelect("JPY"));
		expect(onChange).toHaveBeenCalledWith("JPY");
		act(() => sheet.onSelect("EUR"));
		open(mount().root);
		const recent = sheet.groups.find((g) => g.key === "recent");
		expect(recent?.rows.map((r) => r.id)).toEqual(["EUR", "JPY"]);
		expect(
			JSON.parse(mockSecure.get("retrospend.recent-currencies") ?? "[]"),
		).toEqual(["EUR", "JPY"]);
	});
});
