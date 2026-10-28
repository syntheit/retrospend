import type { RetrospendClient } from "@retrospend/api-client";
import { AffordSheet } from "./AffordSheet";
import { manageRows } from "./ManageList";
import { MergeSheet } from "./MergeSheet";
import { splitAccounts } from "./PayDebtSheet";
import type { BudgetEnvelope, BudgetMonth } from "./source";
import { TargetForm } from "./TargetForm";

// The new sheets end to end with real presses: Save stays off until the
// server's dry run of the exact body is in, the write is that body, and the
// toast carries the server's undo token. Same harness as forms.test.tsx.
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
// The system sheet has no JS to present: show the content while visible.
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: Record<string, unknown>) =>
		visible ? (children as never) : null,
}));
// A segmented control as plain presses, one per option.
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
	};
});

const ars = (minor: number) => ({ minor, currency: "ARS" });
const env = (id: string, name: string, extra = {}) =>
	({
		id,
		name,
		groupId: null,
		assigned: ars(0),
		left: ars(1_000),
		status: "NO_TARGET",
		target: null,
		...extra,
	}) as unknown as BudgetEnvelope;

const food = env("e-food", "Food");
const eatingOut = env("e-out", "Eating out");
const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR", defaultEnvelopeId: "e-food" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(0) },
	groups: [{ id: "g1", name: "Spending", envelopes: [food, eatingOut] }],
} as unknown as BudgetMonth;

const emptyPreview = {
	changes: [],
	unchanged: [],
	unavailable: [],
	detail: { kind: "x", result: {} },
};

function fakeApi() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const preview = (route: string) => async (input: unknown) => {
		calls.push({ route, input });
		return emptyPreview;
	};
	const write =
		(route: string) =>
		async (
			input: unknown,
			init?: { context?: { idempotencyKey?: string } },
		) => {
			calls.push({ route, input, key: init?.context?.idempotencyKey });
			return { result: {}, undo: "undo-token-9" };
		};
	const api = {
		budget: {
			previewSetTarget: preview("previewSetTarget"),
			setTarget: write("setTarget"),
			afford: async (input: unknown) => {
				calls.push({ route: "afford", input });
				return {
					state: "FITS",
					after: ars(7_000),
					short: ars(0),
					left: ars(10_000),
					spent: ars(0),
					notPlanned: ars(0),
					perDay: ars(500),
					daysLeft: 14,
					usualPerDay: null,
					incomplete: false,
					action: null,
				};
			},
			previewMergeEnvelopes: preview("previewMergeEnvelopes"),
			mergeEnvelopes: write("mergeEnvelopes"),
			undo: async (input: unknown) => {
				calls.push({ route: "undo", input });
				return { result: {}, redo: null };
			},
		},
	} as unknown as RetrospendClient;
	return { api, calls };
}

const wait = (ms: number) =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});

/** `label` matches exactly, or as a prefix when it ends with a comma (a row also says its figure). */
function press(tree: Tree, label: string) {
	const hits = tree.root.findAll(
		(n) =>
			(n.props.accessibilityLabel === label ||
				(label.endsWith(",") &&
					String(n.props.accessibilityLabel).startsWith(label))) &&
			typeof n.props.onPress === "function",
	);
	// A prefix label can sit in two lists (the stayer, then the ones to combine): the last is the newest.
	const hit = label.endsWith(",") ? hits[hits.length - 1] : hits[0];
	if (!hit) throw new Error(`nothing to press: ${label}`);
	act(() => {
		(hit.props.onPress as () => void)();
	});
}
const disabled = (tree: Tree, label: string) =>
	tree.root.findAll((n) => n.props.accessibilityLabel === label)[0]?.props
		.accessibilityState as { disabled: boolean } | undefined;

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
});

describe("Set a target", () => {
	it("previews the exact body, writes it once and offers the server's undo", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onDone = jest.fn();
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<TargetForm
					data={data}
					envelope={food}
					month={202610}
					onClose={onClose}
					onDone={onDone}
				/>,
			);
		});
		// No target now and none picked: nothing to ask the server yet.
		await wait(400);
		expect(calls).toEqual([]);
		press(tree, "Monthly");
		press(tree, "2");
		press(tree, "5");
		press(tree, "Three zeros");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewSetTarget");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			envelopeId: "e-food",
			kind: "MONTHLY",
			target: { kind: "MONTHLY", amount: "25000.00", mode: "REFILL" },
		});
		expect(disabled(tree, "Save target")?.disabled).toBe(false);

		press(tree, "Save target");
		await wait(50);
		const writes = calls.filter((c) => c.route === "setTarget");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		const sent = previews[0]?.input as { id: string };
		expect(writes[0]?.key).toBe(sent.id);
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toContain("Food");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-9",
		});
		act(() => tree.unmount());
	});
});

describe("Combine envelopes", () => {
	it("stays off until a stayer and a second envelope are picked, then sends them", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<MergeSheet data={data} onClose={onClose} onDone={jest.fn()} visible />,
			);
		});
		expect(disabled(tree, "Combine")?.disabled).toBe(true);
		press(tree, "Food,");
		await wait(400);
		expect(calls).toEqual([]);
		press(tree, "Eating out,");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewMergeEnvelopes");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			intoId: "e-food",
			fromIds: ["e-out"],
		});
		expect(previews[0]?.input).not.toHaveProperty("name");
		press(tree, "Combine");
		await wait(50);
		expect(calls.filter((c) => c.route === "mergeEnvelopes")).toHaveLength(1);
		expect(onClose).toHaveBeenCalled();
		act(() => tree.unmount());
	});
});

describe("Can I afford it", () => {
	it("asks the server once the amount settles and words the state it answers", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<AffordSheet
					data={data}
					onClose={jest.fn()}
					onMove={jest.fn()}
					visible
				/>,
			);
		});
		press(tree, "3");
		press(tree, "0");
		press(tree, "Three zeros");
		// Still typing: nothing asked yet.
		expect(calls.filter((c) => c.route === "afford")).toHaveLength(0);
		await wait(450);
		const asked = calls.filter((c) => c.route === "afford");
		expect(asked).toHaveLength(1);
		expect(asked[0]?.input).toEqual({ month: 202610, amount: "30000.00" });
		const texts = tree.root
			.findAll(() => true)
			.flatMap((n) =>
				typeof n.props.children === "string" ? [n.props.children] : [],
			);
		expect(texts.some((x) => x.startsWith("Yes. It fits"))).toBe(true);
		act(() => tree.unmount());
	});
});

describe("Manage list", () => {
	it("offers nothing on a closed month and the debt row only on a payoff book", () => {
		expect(manageRows("closed", false)).toEqual([]);
		expect(manageRows("next", false).map((r) => r.key)).toEqual([
			"afford",
			"rules",
			"plan",
			"planApply",
			"fundNow",
		]);
		expect(manageRows("open", false).map((r) => r.key)).toEqual([
			"afford",
			"income",
			"rules",
			"owed",
			"unrouted",
			"whatIf",
			"fundNow",
			"newEnvelope",
			"merge",
			"reconcile",
			"style",
		]);
		expect(manageRows("open", true).map((r) => r.key)).toContain("payDebt");
	});
});

describe("Pay down a debt accounts", () => {
	it("keeps open accounts in the book currency, debts apart from places to pay from", () => {
		const a = (id: string, type: string, currency: string, closed = false) =>
			({ id, type, currency, closedAt: closed ? "2026-01-01" : null }) as never;
		const out = splitAccounts(
			[
				a("cash", "CASH", "ARS"),
				a("card", "LIABILITY_CREDIT_CARD", "ARS"),
				a("usd-loan", "LIABILITY_LOAN", "USD"),
				a("old", "LIABILITY_LOAN", "ARS", true),
			],
			"ARS",
		);
		expect(out.debts.map((x) => x.id)).toEqual(["card"]);
		expect(out.sources.map((x) => x.id)).toEqual(["cash"]);
	});
});
