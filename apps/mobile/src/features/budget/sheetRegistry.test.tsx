import { EnvelopeSheet } from "./EnvelopeSheet";
import { MORE_KINDS } from "./MoreSheets";
import { SHEET_KINDS, SHEETS } from "./sheetRegistry";
import type { BudgetEnvelope, BudgetMonth } from "./source";

// The sheet registry names every kind once with the height it rests at, and
// the envelope sheet leads with one action chosen by the envelope's status.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

jest.mock("@/auth/session", () => ({ useSession: () => ({ api: undefined }) }));
jest.mock("@/ui/Toast", () => ({
	useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));
jest.mock("@/ui/Button", () => {
	const { Pressable } = require("react-native");
	return {
		Button: ({ label, onPress, variant }: Record<string, unknown>) => (
			<Pressable
				accessibilityHint={String(variant ?? "filled")}
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
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: Record<string, unknown>) =>
		visible ? (children as never) : null,
}));
jest.mock("@/ui/Segmented", () => ({ Segmented: () => null }));
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
	};
});

const ars = (minor: number) => ({ minor, currency: "ARS" });
const envelope = (status: string, extra = {}) =>
	({
		id: "e-food",
		name: "Food",
		icon: null,
		groupId: null,
		assigned: ars(100_000),
		spent: ars(120_000),
		left: ars(-20_000),
		spentBasis: 10_000,
		status,
		target: null,
		leftThisWeek: null,
		...extra,
	}) as unknown as BudgetEnvelope;

const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-food" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [],
} as unknown as BudgetMonth;

function buttons(e: BudgetEnvelope, kind: "open" | "closed") {
	let tree: { root: TestNode; unmount(): void } | undefined;
	act(() => {
		tree = create(
			<EnvelopeSheet
				data={data}
				envelope={e}
				kind={kind}
				month={202610}
				onClose={() => undefined}
				onDone={() => undefined}
				startMode="overview"
			/>,
		);
	});
	const found = (tree?.root.findAll(
		(n) =>
			typeof n.props.onPress === "function" &&
			typeof n.props.accessibilityLabel === "string",
	) ?? []) as TestNode[];
	const labels = found.map((n) => [
		n.props.accessibilityLabel,
		n.props.accessibilityHint,
	]);
	act(() => tree?.unmount());
	return labels;
}

describe("sheet registry", () => {
	it("has an entry for every kind the list can open", () => {
		for (const kind of MORE_KINDS) expect(SHEET_KINDS).toContain(kind);
		for (const kind of [
			"usePlan",
			"takeBack",
			"afford",
			"newEnvelope",
			"merge",
			"style",
			"payDebt",
			"reconcile",
		]) {
			expect(SHEET_KINDS).toContain(kind);
		}
	});

	it("rests short tasks at medium and long forms at large", () => {
		const medium = SHEET_KINDS.filter((k) => SHEETS[k].detent === "medium");
		expect(medium.sort()).toEqual(
			["afford", "income", "owed", "takeBack", "whatIf"].sort(),
		);
	});
});

describe("envelope sheet", () => {
	it("leads with Cover when the envelope is over, then the others in a row", () => {
		expect(buttons(envelope("OVERSPENT"), "open")).toEqual([
			["Cover", "filled"],
			["Assign money", "outlined"],
			["Move money", "outlined"],
			["More", undefined],
		]);
	});

	it("leads with Assign money otherwise, and keeps Target and Rename in the menu", () => {
		expect(
			buttons(envelope("NO_TARGET", { left: ars(1_000) }), "open"),
		).toEqual([
			["Assign money", "filled"],
			["Move money", "outlined"],
			["More", undefined],
		]);
	});

	it("offers nothing to change in a closed month", () => {
		expect(buttons(envelope("FUNDED"), "closed")).toEqual([]);
	});
});
