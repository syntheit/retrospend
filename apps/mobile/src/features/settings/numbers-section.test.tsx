import { NumbersSection } from "./NumbersSection";
import type { GeneralSettings } from "./source";

// The Numbers section: each number format option reads as the user's own
// home-currency amount, a change saves one field (null follows the language)
// and the profile is read again so the formatter picks it up.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockUpdate = jest.fn();
const mockRefreshMe = jest.fn();
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: { settings: { update: mockUpdate } },
		refreshMe: mockRefreshMe,
	}),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("@/lib/intl", () => ({ useFormatLocale: () => "en-US" }));
jest.mock("use-intl", () => {
	const { loadMessages } = require("@/lib/i18n");
	const messages = loadMessages("en");
	const lookup = (ns: string | undefined, key: string) =>
		(ns ? `${ns}.${key}` : key)
			.split(".")
			// biome-ignore lint/suspicious/noExplicitAny: a walk over the JSON tree
			.reduce((node: any, part: string) => node?.[part], messages);
	return {
		useTranslations:
			(ns?: string) =>
			(key: string, values: Record<string, unknown> = {}) =>
				String(lookup(ns, key) ?? key).replace(/\{(\w+)\}/g, (_, name) =>
					String(values[name]),
				),
	};
});
jest.mock("@/ui/Form", () => {
	const { Pressable, View } = require("react-native");
	return {
		FormSection: ({ children }: { children: unknown }) => (
			<View>{children}</View>
		),
		FormPickerRow: ({
			label,
			options,
			onChange,
			value,
		}: {
			label: string;
			value: string;
			options: { value: string; label: string }[];
			onChange(value: string): void;
		}) => (
			<View accessibilityLabel={`${label}|${value}`}>
				{options.map((o) => (
					<Pressable
						accessibilityLabel={`${label}|${o.value}|${o.label}`}
						key={o.value}
						onPress={() => onChange(o.value)}
					/>
				))}
			</View>
		),
	};
});

const settings = {
	homeCurrency: "USD",
	numberFormat: null,
	currencySymbolStyle: "standard",
} as unknown as GeneralSettings;

function mount(over: Partial<GeneralSettings> = {}) {
	const onSaved = jest.fn();
	let tree: { root: TestNode };
	act(() => {
		tree = create(
			<NumbersSection onSaved={onSaved} settings={{ ...settings, ...over }} />,
		);
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned inside act above
	return { root: tree!.root, onSaved };
}

const labels = (root: TestNode) =>
	root
		.findAll((n) => typeof n.props.accessibilityLabel === "string")
		.map((n) => n.props.accessibilityLabel as string);

beforeEach(() => {
	jest.clearAllMocks();
	mockUpdate.mockResolvedValue({});
});

describe("NumbersSection", () => {
	it("shows every option as the user's own home-currency amount", () => {
		const { root } = mount();
		expect(labels(root)).toEqual(
			expect.arrayContaining([
				"Number format|follow",
				"Number format|follow|Follow language (USD 1,234,567.89)",
				"Number format|comma_dot|USD 1,234,567.89",
				"Number format|dot_comma|USD 1.234.567,89",
				"Number format|space_comma|USD 1 234 567,89",
			]),
		);
	});

	it("reads the stored format and symbol style", () => {
		const { root } = mount({
			numberFormat: "dot_comma",
			currencySymbolStyle: "native",
		});
		expect(labels(root)).toEqual(
			expect.arrayContaining([
				"Number format|dot_comma",
				"Currency symbol|native",
			]),
		);
	});

	it("saves the chosen format, then reads the profile again", async () => {
		const { root, onSaved } = mount();
		const press = root.findAll(
			(n) =>
				n.props.accessibilityLabel ===
				"Number format|dot_comma|USD 1.234.567,89",
		)[0] as TestNode;
		await act(async () => {
			(press.props.onPress as () => void)();
		});
		expect(mockUpdate).toHaveBeenCalledWith(
			{ numberFormat: "dot_comma" },
			{ context: { idempotencyKey: "key-1" } },
		);
		expect(mockRefreshMe).toHaveBeenCalled();
		expect(onSaved).toHaveBeenCalled();
	});

	it("saves null to follow the language again", async () => {
		const { root } = mount({ numberFormat: "dot_comma" });
		const press = root.findAll((n) =>
			String(n.props.accessibilityLabel).startsWith("Number format|follow|"),
		)[0] as TestNode;
		await act(async () => {
			(press.props.onPress as () => void)();
		});
		expect(mockUpdate).toHaveBeenCalledWith(
			{ numberFormat: null },
			{ context: { idempotencyKey: "key-1" } },
		);
	});
});
