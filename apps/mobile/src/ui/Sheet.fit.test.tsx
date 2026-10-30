import type { ReactElement } from "react";
import { Platform, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AffordSheet } from "@/features/budget/AffordSheet";
import { EnvelopeSheet } from "@/features/budget/EnvelopeSheet";
import type { BudgetEnvelope, BudgetMonth } from "@/features/budget/source";
import type { PersonIdentity } from "@/features/people/source";
import { SettleSheet } from "@/features/settle/SettleSheet";
import type { Account, CurrencyInfo } from "@/features/wealth/source";
import { UpdateBalanceSheet } from "@/features/wealth/UpdateBalanceSheet";
import { PickerSheet } from "./PickerSheet";
import { Sheet, type SheetDetent } from "./Sheet";
import { SHEET_PAD_TOP, sheetContentHeight } from "./sheetContext";

// Build 15 clipped every sheet whose content was sized from a guess at its
// detent: a medium sheet was given a large body, and a long list grew past
// the sheet. The system centers content taller than the sheet, so Update
// balance showed only its keypad, and the envelope overview, Afford and the
// picker lost their header (Settle up its Method and Date). Each sheet here
// renders at medium and at large, on iOS and on Android, and must keep its
// title, its key fields and its footer, with the footer outside the scroll.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	parent: Node | null;
	children: (Node | string)[];
	findAll(match: (node: Node) => boolean): Node[];
}
interface Tree {
	root: Node;
	unmount(): void;
}

const mockDetents: { current: SheetDetent[] } = { current: ["medium"] };

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@expo/ui", () => {
	const React = require("react");
	return {
		BottomSheet: ({ isPresented, children }: Record<string, unknown>) =>
			isPresented ? React.createElement("NativeSheet", {}, children) : null,
		RNHostView: ({ matchContents, children }: Record<string, unknown>) =>
			React.createElement("RNHost", { matchContents }, children),
	};
});
jest.mock("@expo/ui/swift-ui", () => {
	const React = require("react");
	return {
		Host: ({ children }: Record<string, unknown>) => children,
		BottomSheet: ({ isPresented, children }: Record<string, unknown>) =>
			isPresented ? React.createElement("NativeSheet", {}, children) : null,
		Group: ({ modifiers, children }: Record<string, unknown>) =>
			React.createElement("SwiftGroup", { modifiers }, children),
		RNHostView: ({ matchContents, children }: Record<string, unknown>) =>
			React.createElement("RNHost", { matchContents }, children),
	};
});
// The platform frame of the platform under test.
jest.mock("@/ui/SheetFrame", () => {
	const { Platform } = require("react-native");
	const ios = jest.requireActual("@/ui/SheetFrame.ios");
	const android = jest.requireActual("@/ui/SheetFrame.android");
	return {
		SheetFrame: (props: Record<string, unknown>) =>
			(Platform.OS === "ios" ? ios : android).SheetFrame(props),
	};
});
// The real sheet, resting at the detents the case names.
jest.mock("@/ui/Sheet", () => {
	const React = require("react");
	const actual = jest.requireActual("@/ui/Sheet");
	return {
		...actual,
		Sheet: (props: Record<string, unknown>) =>
			React.createElement(actual.Sheet, {
				...props,
				detents: mockDetents.current,
			}),
	};
});
jest.mock("@/ui/Button", () => {
	const { Pressable } = require("react-native");
	return {
		Button: ({ label, onPress }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				onPress={onPress as () => void}
			/>
		),
	};
});
jest.mock("@/ui/Menu", () => {
	const { Pressable } = require("react-native");
	return {
		Menu: ({ label }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				onPress={() => undefined}
			/>
		),
	};
});
jest.mock("@/ui/Segmented", () => ({ Segmented: () => null }));
jest.mock("@/ui/Toast", () => ({
	useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock("@/auth/session", () => ({ useSession: () => ({ api: undefined }) }));
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
		useTranslations: (ns?: string) => {
			const t = (key: string, values: Record<string, unknown> = {}) =>
				String(lookup(ns, key) ?? key).replace(/\{(\w+)\}/g, (_, name) =>
					String(values[name]),
				);
			t.has = (key: string) => lookup(ns, key) !== undefined;
			return t;
		},
		useFormatter: () => ({
			number: (n: number) => String(n),
			dateTime: () => "Oct 12",
		}),
	};
});
// Settle up reads its context from the server; the sheet's own layout is
// what is under test, so the parts inside the body are stand-ins.
jest.mock("@/features/settle/useSettle", () => ({
	useSettle: () => ({
		status: "ready",
		context: {
			currency: "ARS",
			everything: { minor: 100_000, currency: "ARS" },
			unpriced: [],
			today: "2026-10-12",
			yesterday: "2026-10-11",
		},
		direction: "TO_THEM",
		choice: { kind: "everything" },
		preview: null,
		repricing: false,
		recording: false,
		overpaid: false,
		previewFailed: false,
		recordFailed: false,
		shared: [],
		method: "cash",
		paidOn: "2026-10-12",
		typeRates: {},
		rateType: null,
		setChoice: () => undefined,
		setMethod: () => undefined,
		setPaidOn: () => undefined,
		changeDirection: () => undefined,
		changeRate: () => undefined,
		retryLoad: () => undefined,
	}),
}));
jest.mock("@/features/settle/plan", () => ({
	allocationDetail: () => null,
	rateChoices: () => null,
	fillOf: () => ({ minor: 100_000, currency: "ARS" }),
	everythingConverts: () => false,
}));
jest.mock("@/features/settle/SettleHead", () => ({ SettleHead: () => null }));
jest.mock("@/features/settle/AmountChoices", () => ({
	AmountChoices: () => null,
}));
jest.mock("@/features/settle/AfterThis", () => ({
	AfterThis: () => null,
	OverpayAction: () => null,
}));
jest.mock("@/features/settle/PreviewList", () => ({ PreviewList: () => null }));
jest.mock("@/features/settle/SettleDetails", () => {
	const { Text } = require("react-native");
	return {
		RateChips: () => null,
		MethodAndDate: () => (
			<>
				<Text>Method</Text>
				<Text>Date</Text>
			</>
		),
	};
});

const ars = (minor: number) => ({ minor, currency: "ARS" });

const envelopes = [
	"Cafe",
	"Food delivery",
	"Groceries",
	"Health",
	"Rent",
	"Restaurants",
	"Subscriptions",
	"Transport",
	"Everything else",
].map(
	(name, i) =>
		({
			id: `e-${i}`,
			name,
			icon: null,
			kind: "SPENDING",
			groupId: null,
			assigned: ars(100_000),
			spent: ars(120_000),
			left: ars(-20_000),
			spentBasis: 12_000,
			status: "OVERSPENT",
			target: null,
			leftThisWeek: null,
		}) as unknown as BudgetEnvelope,
);

const month = {
	book: { currency: "ARS", style: "LIMITS", defaultEnvelopeId: "e-0" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [{ id: "g", name: "Everyday", envelopes }],
} as unknown as BudgetMonth;

const account = {
	id: "acct-galicia",
	name: "Galicia (ARS)",
	type: "CASH",
	balance: ars(184_000_000),
	updatedAt: "2026-10-12T12:00:00.000Z",
	rateType: null,
} as unknown as Account;

const person = {
	type: "user",
	id: "u-lucia",
	name: "Lucía Gómez",
} as unknown as PersonIdentity;

const noop = () => undefined;

const METRICS = {
	frame: { x: 0, y: 0, width: 402, height: 874 },
	insets: { top: 62, left: 0, right: 0, bottom: 34 },
};

interface Case {
	name: string;
	title: string;
	/** Text or spoken labels that must be in the sheet. */
	fields: string[];
	/** The footer's buttons, pinned under the body; none for a read-only sheet. */
	footer: string[];
	/**
	 * The body comes from SheetBody, which knows the detent; a body from
	 * useSheetBodySize takes most of the window on Android at any detent.
	 */
	sheetBody: boolean;
	render: () => ReactElement;
}

const CASES: Case[] = [
	{
		name: "Update balance",
		title: "Update balance",
		fields: ["Galicia (ARS)", "1", "0"],
		footer: ["Update balance"],
		sheetBody: true,
		render: () => (
			<UpdateBalanceSheet
				account={account}
				catalog={[] as CurrencyInfo[]}
				home="ARS"
				onClose={noop}
				onDone={noop}
				visible
			/>
		),
	},
	{
		name: "Envelope overview",
		title: "Cafe",
		fields: ["Limit", "Spent", "Left"],
		footer: [],
		sheetBody: true,
		render: () => (
			<EnvelopeSheet
				data={month}
				envelope={envelopes[0] ?? null}
				kind="open"
				month={202610}
				onClose={noop}
				onDone={noop}
				startMode="overview"
			/>
		),
	},
	{
		name: "Afford",
		title: "Can I afford it?",
		fields: ["Which envelope?", "Any envelope"],
		footer: [],
		sheetBody: true,
		render: () => (
			<AffordSheet data={month} onClose={noop} onMove={noop} visible />
		),
	},
	{
		name: "Envelope picker",
		title: "Envelope",
		fields: ["Everyday", "Cafe", "Everything else"],
		footer: [],
		sheetBody: false,
		render: () => (
			<PickerSheet
				clear="Clear"
				empty="Nothing found"
				find="Find"
				groups={[
					{
						key: "g",
						heading: "Everyday",
						rows: envelopes.map((e) => ({
							id: e.id,
							label: e.name,
							lead: null,
							selected: false,
						})),
					},
				]}
				onClose={noop}
				onSelect={noop}
				title="Envelope"
				visible
			/>
		),
	},
	{
		name: "Settle up",
		title: "Settle up with Lucía",
		fields: ["Amount", "Method", "Date"],
		footer: ["Cancel", "Record payment"],
		sheetBody: false,
		render: () => (
			<SettleSheet onClose={noop} onDone={noop} person={person} visible />
		),
	},
];

function textOf(node: Node): string {
	return node.children
		.map((c) => (typeof c === "string" ? c : textOf(c)))
		.join("");
}

function has(tree: Tree, what: string): boolean {
	return (
		tree.root.findAll(
			(n) =>
				n.props.accessibilityLabel === what ||
				(n.type === Text && textOf(n) === what),
		).length > 0
	);
}

function inside(node: Node, ancestor: Node): boolean {
	for (let p = node.parent; p; p = p.parent) if (p === ancestor) return true;
	return false;
}

function styleOf(node: Node) {
	return StyleSheet.flatten(node.props.style as never) ?? {};
}

/** The scrolling body: the outermost scroll view in the sheet. */
function bodyOf(tree: Tree): Node {
	const scrolls = tree.root.findAll((n) => n.type === ScrollView);
	const body = scrolls.find((s) => !scrolls.some((o) => inside(s, o)));
	if (!body) throw new Error("no scrolling body");
	return body;
}

function mount(c: Case, detents: SheetDetent[]): Tree {
	mockDetents.current = detents;
	let tree!: Tree;
	act(() => {
		tree = create(
			<SafeAreaProvider initialMetrics={METRICS}>
				{c.render()}
			</SafeAreaProvider>,
		);
	});
	return tree;
}

function checkContent(tree: Tree, c: Case) {
	expect(has(tree, c.title)).toBe(true);
	const body = bodyOf(tree);
	for (const field of c.fields) {
		const found = tree.root.findAll(
			(n) =>
				(n.props.accessibilityLabel === field ||
					(n.type === Text && textOf(n) === field)) &&
				inside(n, body),
		);
		expect([field, found.length > 0]).toEqual([field, true]);
	}
	for (const label of c.footer) {
		const button = tree.root.findAll(
			(n) =>
				n.props.accessibilityLabel === label &&
				typeof n.props.onPress === "function",
		);
		expect([label, button.length]).toEqual([label, 1]);
		expect(inside(button[0] as Node, body)).toBe(false);
	}
}

const DETENTS: { at: string; detents: SheetDetent[] }[] = [
	{ at: "medium", detents: ["medium"] },
	{ at: "large", detents: ["large"] },
	{ at: "medium, pulled up to large", detents: ["medium", "large"] },
];
const window = () => require("react-native").Dimensions.get("window").height;

/** The text scale of the window; the jest default (2) is a big text size. */
function setFontScale(fontScale: number) {
	const { Dimensions } = require("react-native");
	const now = Dimensions.get("window");
	Dimensions.set({
		window: { ...now, fontScale },
		screen: { ...now, fontScale },
	});
}

describe.each(CASES)("$name", (c) => {
	const os = Platform.OS;
	beforeEach(() => setFontScale(1));
	afterEach(() => {
		Platform.OS = os;
	});

	it.each(DETENTS)(
		"sizes the iOS sheet to $at and keeps its header, fields and footer",
		({ detents }) => {
			Platform.OS = "ios";
			const tree = mount(c, detents);
			checkContent(tree, c);
			// The content is a column the height of the detent the sheet rests
			// at, pinned to the top of the sheet. Nothing between it and the
			// body claims a height of its own, so the body flexes into the room
			// between the header and the footer and scrolls the rest.
			const host = tree.root.findAll((n) => n.type === "RNHost")[0] as Node;
			const rest = detents.includes("medium") ? "medium" : "large";
			const expected =
				sheetContentHeight(rest, {
					window: window(),
					top: METRICS.insets.top,
					bottom: METRICS.insets.bottom,
				}) - SHEET_PAD_TOP;
			expect(expected).toBeLessThan(
				rest === "medium" ? window() / 2 : window() - METRICS.insets.top,
			);
			const group = tree.root.findAll((n) => n.type === "SwiftGroup")[0];
			expect(JSON.stringify(group?.props.modifiers)).toContain("topLeading");
			const body = bodyOf(tree);
			let column: Node | null = body;
			while (
				column &&
				column !== host &&
				styleOf(column).height === undefined
			) {
				const style = styleOf(column);
				expect(style.maxHeight).toBeUndefined();
				expect(style.minHeight ?? 0).toBe(0);
				column = column.parent;
			}
			expect(column && column !== host).toBe(true);
			expect(styleOf(column as Node).height).toBe(expected);
			expect(styleOf(body.parent as Node).flex ?? 1).toBe(1);
			if (detents.length > 1) {
				// Pulled up to large, the content follows the sheet.
				const modifiers = group?.props.modifiers as {
					$type: string;
					eventListener?: (args: { detent: string }) => void;
				}[];
				const track = modifiers.find((m) => m.$type === "presentationDetents");
				act(() => track?.eventListener?.({ detent: "large" }));
				const large =
					sheetContentHeight("large", {
						window: window(),
						top: METRICS.insets.top,
						bottom: METRICS.insets.bottom,
					}) - SHEET_PAD_TOP;
				const tall = tree.root.findAll(
					(n) => styleOf(n).height === large && inside(bodyOf(tree), n),
				);
				expect(tall.length).toBeGreaterThan(0);
				checkContent(tree, c);
			}
			act(() => tree.unmount());
		},
	);

	it.each(DETENTS)(
		"keeps the Android body inside the sheet at $at",
		({ detents }) => {
			Platform.OS = "android";
			const tree = mount(c, detents);
			checkContent(tree, c);
			const host = tree.root.findAll((n) => n.type === "RNHost")[0] as Node;
			// Never taller than most of the window, and never taller than half
			// of it when medium is the only height.
			// The body is bounded (a height or a max height), so a long list
			// scrolls instead of pushing the footer off the sheet.
			const body = bodyOf(tree);
			let bound = Number.POSITIVE_INFINITY;
			let tallest = 0;
			for (let n: Node | null = body; n && n !== host; n = n.parent) {
				const style = styleOf(n);
				const cap = style.height ?? style.maxHeight;
				if (typeof cap === "number") bound = Math.min(bound, cap);
				tallest = Math.max(tallest, Number(style.minHeight ?? 0));
			}
			expect(bound).toBeLessThan(Number.POSITIVE_INFINITY);
			tallest = Math.max(tallest, bound);
			expect(tallest).toBeLessThan(
				detents.includes("large") || !c.sheetBody ? window() : window() / 2,
			);
			act(() => tree.unmount());
		},
	);
});

// At a big text size every sheet with detents rests at large: the body gets
// the whole window and scrolls above the pinned footer.
describe("big text", () => {
	const os = Platform.OS;
	afterEach(() => {
		Platform.OS = os;
		setFontScale(1);
	});
	const detentsOf = (fontScale: number, detents: SheetDetent[]) => {
		setFontScale(fontScale);
		Platform.OS = "ios";
		mockDetents.current = detents;
		let tree!: Tree;
		act(() => {
			tree = create(
				<SafeAreaProvider initialMetrics={METRICS}>
					<Sheet onClose={noop} title="Month starts on day" visible>
						<Text>Body</Text>
					</Sheet>
				</SafeAreaProvider>,
			);
		});
		const group = tree.root.findAll((n) => n.type === "SwiftGroup")[0];
		const modifiers = group?.props.modifiers as { $type: string }[];
		const set = modifiers.find((m) => m.$type === "presentationDetents");
		act(() => tree.unmount());
		return JSON.stringify(set);
	};

	it("keeps medium at the default size", () => {
		expect(detentsOf(1, ["medium"])).toContain("medium");
	});

	it("rests a medium sheet at large when the text is big", () => {
		const set = detentsOf(2, ["medium", "large"]);
		expect(set).toContain("large");
		expect(set).not.toContain("medium");
		expect(detentsOf(2, ["medium"])).not.toContain("medium");
	});
});

// The composer's cards are the surface color; on a surface sheet they did not
// read as cards. A grouped sheet takes the page color under them.
describe("grouped sheet", () => {
	const { color } = require("@retrospend/tokens/theme").light;
	const backgroundOf = (grouped: boolean) => {
		Platform.OS = "ios";
		mockDetents.current = ["large"];
		let tree!: Tree;
		act(() => {
			tree = create(
				<SafeAreaProvider initialMetrics={METRICS}>
					<Sheet grouped={grouped} onClose={noop} title="Expense" visible>
						<Text>Card</Text>
					</Sheet>
				</SafeAreaProvider>,
			);
		});
		const group = tree.root.findAll((n) => n.type === "SwiftGroup")[0];
		const modifiers = group?.props.modifiers as { $type: string }[];
		const paint = modifiers.find((m) => m.$type === "presentationBackground");
		act(() => tree.unmount());
		return JSON.stringify(paint);
	};

	it("paints the page color under the cards, and the surface otherwise", () => {
		expect(backgroundOf(true)).toContain(color.bg);
		expect(backgroundOf(false)).toContain(color.surface);
	});
});
