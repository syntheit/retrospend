import type { RetrospendClient } from "@retrospend/api-client";
import { AssignForm } from "./AssignForm";
import type { BudgetEnvelope, BudgetMonth } from "./source";

// The money form end to end with real presses on its real keypad: Assign is
// off until the server's dry run of the exact body is in, the write carries
// that body and one idempotency key, and the toast hands back the server's
// undo token. react-test-renderer is a dev dependency of the app.
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
// The native buttons and controls have no JS to press: stand-ins with the same props.
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

const envelope = {
	id: "env-groceries",
	name: "Groceries",
	assigned: ars(0),
	left: ars(0),
	status: "NO_TARGET",
} as unknown as BudgetEnvelope;

const data = {
	book: { currency: "ARS", style: "EVERY_DOLLAR" },
	month: { key: 202610, state: "OPEN" },
	toAssign: { poolName: "TO_ASSIGN", amount: ars(85_890_000) },
	groups: [{ id: "g1", envelopes: [envelope] }],
} as unknown as BudgetMonth;

const preview = (before: number, after: number, extra = false) => ({
	changes: [
		...(extra
			? [
					{
						id: "budget.leftInLimits",
						currency: "ARS",
						before: ars(500_000),
						after: ars(450_000),
						delta: ars(-50_000),
						figureAfter: [],
					},
				]
			: []),
		{
			id: "budget.notPlannedYet",
			currency: "ARS",
			before: ars(85_890_000),
			after: ars(85_890_000 - (after - before)),
			delta: ars(before - after),
			figureAfter: [],
		},
	],
	unchanged: [{ id: "budget.leftToSpend", lines: [ars(-18_090_000)] }],
	unavailable: extra ? [{ id: "netWorth", before: [ars(1)], after: null }] : [],
	detail: {
		kind: "envelope.assign",
		result: {
			movements: [],
			envelopes: [
				{ id: "env-groceries", before: ars(before), after: ars(after) },
			],
			toAssign: {
				before: ars(85_890_000),
				after: ars(85_890_000 - (after - before)),
			},
		},
	},
});

function fakeApi(
	options: {
		previewFails?: boolean;
		previewRefusedWith?: number;
		extra?: boolean;
	} = {},
) {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const api = {
		budget: {
			previewAssign: async (input: { items: { amount: string }[] }) => {
				calls.push({ route: "previewAssign", input });
				if (options.previewFails) throw new Error("down");
				if (options.previewRefusedWith)
					throw Object.assign(new Error("refused"), {
						status: options.previewRefusedWith,
					});
				const minor = Math.round(Number(input.items[0]?.amount) * 100);
				return preview(0, minor, options.extra);
			},
			assign: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "assign",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { result: {}, undo: "undo-token-1" };
			},
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

async function open(onDone = jest.fn(), onClose = jest.fn()) {
	let tree!: Tree;
	await act(async () => {
		tree = create(
			<AssignForm
				data={data}
				envelope={envelope}
				month={202610}
				onClose={onClose}
				onDone={onDone}
			/>,
		);
	});
	return { tree, onDone, onClose };
}

function press(tree: Tree, label: string) {
	const hit = tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onPress === "function",
	)[0];
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

describe("Assign money", () => {
	it("keeps Assign off until the dry run of the exact body is in, then writes that body once", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const { tree, onDone, onClose } = await open();

		expect(disabled(tree, "Assign")?.disabled).toBe(true);
		press(tree, "5");
		press(tree, "0");
		press(tree, "Three zeros");
		// Typing is still going: nothing has been asked of the server yet.
		expect(calls).toEqual([]);
		expect(disabled(tree, "Assign")?.disabled).toBe(true);

		await wait(400);
		const previews = calls.filter((c) => c.route === "previewAssign");
		expect(previews).toHaveLength(1);
		const body = previews[0]?.input as {
			batchId: string;
			mode: string;
			month: number;
			items: { id: string; envelopeId: string; amount: string }[];
		};
		expect(body).toMatchObject({
			mode: "add",
			month: 202610,
			items: [{ envelopeId: "env-groceries", amount: "50000.00" }],
		});
		expect(disabled(tree, "Assign")?.disabled).toBe(false);
		expect(calls.some((c) => c.route === "assign")).toBe(false);

		press(tree, "Assign");
		await wait(50);
		const writes = calls.filter((c) => c.route === "assign");
		expect(writes).toHaveLength(1);
		// The write is the very body that was previewed, keyed by its batch id.
		expect(writes[0]?.input).toEqual(body);
		expect(writes[0]?.key).toBe(body.batchId);

		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		expect(mockToast.show).toHaveBeenCalledTimes(1);
		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toContain("Groceries");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-token-1",
		});
		act(() => tree.unmount());
	});

	it("a changed amount is a different write: new ids, one more dry run", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const { tree } = await open();
		press(tree, "7");
		await wait(400);
		press(tree, "0");
		await wait(400);
		const previews = calls.filter((c) => c.route === "previewAssign");
		expect(previews).toHaveLength(2);
		const [first, second] = previews.map(
			(c) => (c.input as { batchId: string }).batchId,
		);
		expect(first).not.toBe(second);
		act(() => tree.unmount());
	});

	it("says so and stays off when the dry run fails", async () => {
		const { api, calls } = fakeApi({ previewFails: true });
		mockSession.api = api;
		const { tree } = await open();
		press(tree, "9");
		await wait(400);
		expect(disabled(tree, "Assign")?.disabled).toBe(true);
		const texts = tree.root
			.findAll(() => true)
			.flatMap((n) =>
				typeof n.props.children === "string" ? [n.props.children] : [],
			)
			.join("|");
		expect(texts).toContain("Couldn't check this");
		expect(calls.some((c) => c.route === "assign")).toBe(false);
		act(() => tree.unmount());
	});

	it("says the server refused it (a 4xx) instead of offering a retry", async () => {
		const { api, calls } = fakeApi({ previewRefusedWith: 400 });
		mockSession.api = api;
		const { tree } = await open();
		press(tree, "9");
		await wait(400);
		expect(disabled(tree, "Assign")?.disabled).toBe(true);
		const texts = tree.root
			.findAll(() => true)
			.flatMap((n) =>
				typeof n.props.children === "string" ? [n.props.children] : [],
			)
			.join("|");
		expect(texts).toContain("This cannot be done as it is");
		expect(calls.some((c) => c.route === "assign")).toBe(false);
		act(() => tree.unmount());
	});

	it("lays out every figure the dry run lists, what stays and what could not be checked", async () => {
		const { api } = fakeApi({ extra: true });
		mockSession.api = api;
		const { tree } = await open();
		press(tree, "5");
		await wait(400);
		const texts = tree.root
			.findAll(() => true)
			.flatMap((n) =>
				typeof n.props.children === "string" ? [n.props.children] : [],
			)
			.join("|");
		// Not only the envelope and the pool: the hero figure of a Limits book moves too.
		expect(texts).toContain("Left in your limits");
		expect(texts).toContain("To assign");
		expect(texts).toContain(
			"Nothing else changes: left to spend stays as it is.",
		);
		expect(texts).toContain("Could not check net worth.");
		act(() => tree.unmount());
	});
});
