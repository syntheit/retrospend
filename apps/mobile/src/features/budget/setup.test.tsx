import type { RetrospendClient } from "@retrospend/api-client";
import { SetupSheet } from "./SetupSheet";
import {
	EXTRA_DEBT_KEY,
	payAnswered,
	type SetupDraft,
	type SetupPreset,
	setupBody,
	stepsOf,
} from "./setupBody";

// The wizard end to end: the body built from the server's proposal, and real
// presses through the steps (Start stays off until the dry run of the exact
// setup is in; a plan that costs more than you have stops until you say the
// rest comes from your pay; the write carries one idempotency key).
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
jest.mock("@/ui/SwitchRow", () => {
	const { Pressable } = require("react-native");
	return {
		SwitchRow: ({
			label,
			onChange,
			value,
		}: {
			label: string;
			onChange: (v: boolean) => void;
			value: boolean;
		}) => (
			<Pressable
				accessibilityLabel={label}
				accessibilityState={{ selected: value }}
				onPress={() => onChange(!value)}
			/>
		),
	};
});
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: Record<string, unknown>) =>
		visible ? (children as never) : null,
}));
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

const preset = {
	style: "FLEX",
	currency: "ARS",
	missingRates: [],
	groups: [
		{ key: "bills", nameKey: "envelope.groups.bills", role: "BILLS" },
		{ key: "spending", nameKey: "envelope.groups.spending", role: "SPENDING" },
	],
	envelopes: [
		{
			key: "rent",
			nameKey: null,
			name: "Rent",
			groupKey: "bills",
			kind: "MONTHLY",
			isDefault: false,
			categoryIds: ["c1"],
			templateId: null,
			target: {
				kind: "MONTHLY",
				amount: "5000.00",
				mode: "REFILL",
				cadence: "MONTH",
			},
		},
		{
			key: "gym",
			nameKey: null,
			name: "Gym",
			groupKey: "bills",
			kind: "NONE",
			isDefault: false,
			categoryIds: [],
			templateId: null,
			target: null,
		},
		{
			key: "else",
			nameKey: "envelope.envelopes.everythingElse",
			name: null,
			groupKey: "spending",
			kind: "NONE",
			isDefault: true,
			categoryIds: [],
			templateId: null,
			target: null,
		},
	],
} as unknown as SetupPreset;

const nameOf = (key: string | null, fallback: string | null) =>
	fallback ??
	(key === "envelope.envelopes.everythingElse"
		? "Everything else"
		: (key ?? ""));
const fresh: SetupDraft = {
	style: "FLEX",
	off: new Set(),
	amounts: {},
	haveNowMinor: null,
	pay: { frequency: null, next: "" },
	strategy: "AVALANCHE",
};

describe("setupBody", () => {
	it("sends the proposal as it came, names translated, nothing asked left out", () => {
		const body = setupBody(preset, fresh, nameOf);
		expect(body?.style).toBe("FLEX");
		expect(body?.groups.map((g) => g.name)).toEqual([
			"envelope.groups.bills",
			"envelope.groups.spending",
		]);
		expect(body?.envelopes.map((e) => [e.key, e.name])).toEqual([
			["rent", "Rent"],
			["gym", "Gym"],
			["else", "Everything else"],
		]);
		expect(body?.envelopes[0]?.target).toEqual({
			kind: "MONTHLY",
			amount: "5000.00",
			mode: "REFILL",
			cadence: "MONTH",
		});
		expect(body).not.toHaveProperty("startingMoney");
		expect(body).not.toHaveProperty("pay");
	});

	it("drops an envelope turned off but never the default one, and changes only the amount", () => {
		const body = setupBody(
			preset,
			{
				...fresh,
				off: new Set(["gym", "else"]),
				amounts: { rent: 750050 },
				haveNowMinor: 12345,
				pay: { frequency: "MONTHLY", next: "2026-11-05" },
			},
			nameOf,
		);
		expect(body?.envelopes.map((e) => e.key)).toEqual(["rent", "else"]);
		expect(body?.envelopes[0]?.target).toMatchObject({
			kind: "MONTHLY",
			amount: "7500.50",
			mode: "REFILL",
		});
		expect(body?.startingMoney).toBe("123.45");
		expect(body?.pay).toEqual({ frequency: "MONTHLY", nextPay: "2026-11-05" });
	});

	it("asks no money now in Limits and sends the payoff extra on the extra envelope", () => {
		const limits = setupBody(
			preset,
			{ ...fresh, style: "LIMITS", haveNowMinor: 500 },
			nameOf,
		);
		expect(limits).not.toHaveProperty("startingMoney");
		const debt = {
			...preset,
			envelopes: [
				...preset.envelopes,
				{
					key: EXTRA_DEBT_KEY,
					nameKey: null,
					name: "Extra debt payment",
					groupKey: "bills",
					kind: "MONTHLY",
					isDefault: false,
					categoryIds: [],
					templateId: null,
					target: {
						kind: "MONTHLY",
						amount: "100.00",
						mode: "SET_ASIDE",
						cadence: "MONTH",
					},
				},
			],
		} as unknown as SetupPreset;
		const body = setupBody(
			debt,
			{ ...fresh, style: "DEBT_PAYOFF", amounts: { [EXTRA_DEBT_KEY]: 25050 } },
			nameOf,
		);
		expect(body?.payoff).toEqual({
			strategy: "AVALANCHE",
			extraMonthly: "250.50",
			envelopeKey: EXTRA_DEBT_KEY,
		});
	});
});

describe("steps and pay", () => {
	it("asks fewer questions for Track and Limits and wants a dated pay to be today or later", () => {
		expect(stepsOf("TRACK")).toEqual(["style"]);
		expect(stepsOf("LIMITS")).toEqual(["style", "envelopes"]);
		expect(stepsOf("FLEX")).toEqual(["style", "pay", "money", "envelopes"]);
		expect(payAnswered({ frequency: null, next: "" }, "2026-10-28")).toBe(true);
		expect(payAnswered({ frequency: "VARIES", next: "" }, "2026-10-28")).toBe(
			true,
		);
		expect(
			payAnswered({ frequency: "MONTHLY", next: "2026-10-27" }, "2026-10-28"),
		).toBe(false);
		expect(
			payAnswered({ frequency: "MONTHLY", next: "2026-10-28" }, "2026-10-28"),
		).toBe(true);
		expect(
			payAnswered({ frequency: "MONTHLY", next: "soon" }, "2026-10-28"),
		).toBe(false);
	});
});

function fakeApi(short: number) {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const result = {
		bookId: "b1",
		openBalances: [],
		plan: {
			cost: ars(9_000),
			available: ars(9_000 - short),
			short: ars(short),
		},
		nextPay: "2026-11-05",
		payoff: null,
	};
	const api = {
		budget: {
			setupPreset: async (input: unknown) => {
				calls.push({ route: "setupPreset", input });
				return preset;
			},
			previewSetup: async (input: unknown) => {
				calls.push({ route: "previewSetup", input });
				return {
					changes: [],
					unchanged: [],
					unavailable: [],
					detail: { kind: "setup", result },
				};
			},
			setup: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "setup",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { result, undo: null };
			},
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
			n.props.accessibilityLabel === label &&
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

async function walkToEnvelopes(tree: Tree) {
	press(tree, "Continue");
	press(tree, "It varies");
	press(tree, "Continue");
	press(tree, "5");
	press(tree, "Three zeros");
	press(tree, "Continue");
	await wait(450);
}

describe("Set up your budget", () => {
	it("previews the exact setup, writes it once and ends in a toast with no Undo", async () => {
		const { api, calls } = fakeApi(0);
		mockSession.api = api;
		const onClose = jest.fn();
		const onDone = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(<SetupSheet onClose={onClose} onDone={onDone} visible />);
		});
		await wait(10);
		await walkToEnvelopes(tree);
		const previews = calls.filter((c) => c.route === "previewSetup");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.input).toMatchObject({
			style: "FLEX",
			startingMoney: "5000.00",
			pay: { frequency: "VARIES", nextPay: null },
		});
		expect(disabled(tree, "Start my budget")).toBe(false);
		press(tree, "Start my budget");
		await wait(50);
		const writes = calls.filter((c) => c.route === "setup");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(previews[0]?.input);
		expect(writes[0]?.key).toMatch(/^00000000-/);
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();
		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo?: unknown;
		};
		expect(toast.message).toBe("Your budget is ready");
		expect(toast.undo).toBeUndefined();
		act(() => tree.unmount());
	});

	it("stops a plan that costs more than you have until the rest is covered by pay", async () => {
		const { api, calls } = fakeApi(2_000);
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<SetupSheet onClose={jest.fn()} onDone={jest.fn()} visible />,
			);
		});
		await wait(10);
		await walkToEnvelopes(tree);
		expect(disabled(tree, "Start anyway")).toBe(true);
		press(tree, "Use my pay for the rest");
		expect(disabled(tree, "Start my budget")).toBe(false);
		press(tree, "Start my budget");
		await wait(50);
		expect(calls.filter((c) => c.route === "setup")).toHaveLength(1);
		act(() => tree.unmount());
	});

	it("writes nothing for Just track", async () => {
		const { api, calls } = fakeApi(0);
		mockSession.api = api;
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<SetupSheet onClose={onClose} onDone={jest.fn()} visible />,
			);
		});
		press(tree, "Just track");
		press(tree, "Start tracking");
		await wait(50);
		expect(onClose).toHaveBeenCalled();
		expect(
			calls.filter((c) => c.route === "setup" || c.route === "previewSetup"),
		).toEqual([]);
		act(() => tree.unmount());
	});
});
