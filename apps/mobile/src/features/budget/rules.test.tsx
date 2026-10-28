import type { RetrospendClient } from "@retrospend/api-client";
import { RulesSheet } from "./RulesSheet";
import { createRuleBody, movedIds, percentBasisPoints } from "./rulesBody";
import type { BudgetMonth } from "./source";

// Income rules end to end: the body of a new rule, and presses through the
// list. Pausing and moving move no money and write at once; applying a rule
// to this month's money in is previewed first and ends in an Undo toast.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}
interface Tree {
	root: TestNode;
	unmount(): void;
}

const mockSession: { api: unknown } = { api: undefined };
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: mockSession.api }),
}));
let mockIdCounter = 0;
jest.mock("@/data/ids", () => ({
	newClientId: () =>
		`00000000-0000-4000-8000-${String(++mockIdCounter).padStart(12, "0")}`,
}));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("@/ui/Button", () => {
	const { Pressable } = require("react-native");
	return {
		Button: ({ label, onPress, disabled }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				accessibilityState={{ disabled: Boolean(disabled) }}
				onPress={disabled ? undefined : (onPress as () => void)}
			/>
		),
	};
});
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: Record<string, unknown>) =>
		visible ? (children as never) : null,
}));
jest.mock("@/ui/Segmented", () => {
	const { Pressable } = require("react-native");
	return {
		Segmented: ({
			options,
			onChange,
		}: {
			options: { value: string; label: string }[];
			onChange: (value: string) => void;
		}) =>
			options.map((o) => (
				<Pressable
					accessibilityLabel={o.label}
					key={o.value}
					onPress={() => onChange(o.value)}
				/>
			)),
	};
});
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
			number: (n: number) => `${Math.round(n * 100)}%`,
			dateTime: () => "October",
		}),
	};
});

const ars = (minor: number) => ({ minor, currency: "ARS" });
const data = {
	book: { currency: "ARS", style: "SAVE_FIRST", defaultEnvelopeId: "e-else" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [
		{
			id: "g1",
			name: "Savings",
			envelopes: [
				{ id: "e-save", name: "Savings", left: ars(0) },
				{ id: "e-else", name: "Everything else", left: ars(0) },
			],
		},
	],
} as unknown as BudgetMonth;

const rule = (id: string, name: string, active = true) => ({
	id,
	name,
	sortOrder: 0,
	match: { kind: "ANY" },
	action: { kind: "PERCENT", basisPoints: 2000, amount: null },
	envelopeId: "e-save",
	active,
	createdAt: "2026-10-01T00:00:00Z",
});

function fakeApi() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const plain = (route: string, out: unknown) => async (input: unknown) => {
		calls.push({ route, input });
		return out;
	};
	const api = {
		budget: {
			rules: plain("rules", [rule("r1", "Save first"), rule("r2", "The rest")]),
			updateRule: plain("updateRule", {}),
			reorderRules: plain("reorderRules", {}),
			archiveRule: plain("archiveRule", {}),
			previewApplyRule: plain("previewApplyRule", {
				changes: [],
				unchanged: [],
				unavailable: [],
				detail: { kind: "x", result: {} },
			}),
			applyRule: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "applyRule",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { result: {}, undo: "undo-token-4" };
			},
			undo: plain("undo", { result: {}, redo: null }),
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

const wait = (ms: number) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
function press(tree: Tree, label: string) {
	const hit = tree.root.findAll(
		(n) =>
			(n.props.accessibilityLabel === label ||
				(label.endsWith(",") &&
					String(n.props.accessibilityLabel).startsWith(label))) &&
			typeof n.props.onPress === "function",
	)[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}
const disabled = (tree: Tree, label: string) =>
	(
		tree.root.findAll((n) => n.props.accessibilityLabel === label)[0]?.props
			.accessibilityState as { disabled: boolean } | undefined
	)?.disabled;

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
});

describe("rule bodies", () => {
	it("reads a percent as hundredths without a float and refuses what the server would", () => {
		expect(percentBasisPoints("20")).toBe(2000);
		expect(percentBasisPoints("12,5")).toBe(1250);
		expect(percentBasisPoints("0.01")).toBe(1);
		expect(percentBasisPoints("100")).toBe(10_000);
		expect(percentBasisPoints("100.01")).toBeNull();
		expect(percentBasisPoints("0")).toBeNull();
		expect(percentBasisPoints("1.234")).toBeNull();
		expect(percentBasisPoints("")).toBeNull();
	});

	it("builds the three kinds and needs a name and an envelope", () => {
		const base = {
			id: "r",
			name: " Save first ",
			percentText: "",
			minor: null,
			currency: "ARS",
			envelopeId: "e-save",
		};
		expect(createRuleBody({ ...base, kind: "REMAINDER" })).toEqual({
			id: "r",
			name: "Save first",
			match: { kind: "ANY" },
			action: { kind: "REMAINDER" },
			envelopeId: "e-save",
		});
		expect(
			createRuleBody({ ...base, kind: "PERCENT", percentText: "12.5" })?.action,
		).toEqual({ kind: "PERCENT", basisPoints: 1250 });
		expect(
			createRuleBody({ ...base, kind: "AMOUNT", minor: 500_050 })?.action,
		).toEqual({ kind: "AMOUNT", amount: "5000.50" });
		expect(createRuleBody({ ...base, kind: "PERCENT" })).toBeNull();
		expect(createRuleBody({ ...base, kind: "AMOUNT", minor: 0 })).toBeNull();
		expect(
			createRuleBody({ ...base, kind: "REMAINDER", envelopeId: null }),
		).toBeNull();
		expect(
			createRuleBody({ ...base, kind: "REMAINDER", name: " " }),
		).toBeNull();
	});

	it("moves a rule one place and stops at the ends", () => {
		expect(movedIds(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
		expect(movedIds(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
		expect(movedIds(["a", "b", "c"], 0, -1)).toBeNull();
		expect(movedIds(["a", "b", "c"], 2, 1)).toBeNull();
	});
});

describe("Income rules sheet", () => {
	it("lists the rules, pauses one at once and moves nothing it was not asked to", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<RulesSheet
					data={data}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		press(tree, "Save first,");
		press(tree, "Pause");
		await wait(20);
		expect(calls.find((c) => c.route === "updateRule")?.input).toEqual({
			id: "r1",
			active: false,
		});
		act(() => tree.unmount());
	});

	it("previews applying a rule to this month, writes the same body once and offers Undo", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onClose = jest.fn();
		const onDone = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<RulesSheet data={data} onClose={onClose} onDone={onDone} visible />,
			);
		});
		press(tree, "Save first,");
		press(tree, "Apply to this month's money in");
		expect(disabled(tree, "Apply")).toBe(true);
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewApplyRule");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({ ruleId: "r1" });
		expect(disabled(tree, "Apply")).toBe(false);
		press(tree, "Apply");
		await wait(50);
		const writes = calls.filter((c) => c.route === "applyRule");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toBe(
			(previews[0]?.input as { batchId: string }).batchId,
		);
		expect(onDone).toHaveBeenCalled();
		const toast = mockToast.show.mock.calls[0]?.[0] as {
			undo: { onUndo: () => Promise<void> };
		};
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-4",
		});
		act(() => tree.unmount());
	});
});
