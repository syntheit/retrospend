import type { RetrospendClient } from "@retrospend/api-client";
import type { AccountDetail } from "./source";
import { UpdateBalanceSheet } from "./UpdateBalanceSheet";

// Update balance with real presses on the real keypad: the dry run comes
// first, the write carries the typed balance as decimal text under one
// idempotency key, and the toast undoes it with the accounts undo token.
const renderer = require(
	require.resolve("react-test-renderer", {
		paths: [require.resolve("jest-expo/package.json")],
	}),
);
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
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ visible, children }: { visible: boolean; children: unknown }) =>
		visible ? children : null,
}));
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

const account = {
	id: "acct-galicia",
	name: "Galicia (ARS)",
	balance: ars(184_000_000),
} as unknown as AccountDetail;

function fakeApi() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const api = {
		accounts: {
			previewUpdateBalance: async (input: { balance: string }) => {
				calls.push({ route: "preview", input });
				const after = Math.round(Number(input.balance) * 100);
				return {
					changes: [
						{
							id: "netWorth",
							currency: "ARS",
							before: ars(1_196_764_895),
							after: ars(1_196_764_895 + after - 184_000_000),
							delta: ars(after - 184_000_000),
							figureAfter: [],
						},
					],
					unchanged: [],
					unavailable: [],
					detail: {
						kind: "account.updateBalance",
						result: {
							before: ars(184_000_000),
							after: ars(after),
							notLogged: ars(after - 184_000_000),
						},
					},
				};
			},
			updateBalance: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "write",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { result: {}, undo: "undo-balance-1" };
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

describe("Update balance", () => {
	it("previews the typed balance, writes it under one key and undoes it with the token", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onDone = jest.fn();
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<UpdateBalanceSheet
					account={account}
					onClose={onClose}
					onDone={onDone}
					visible
				/>,
			);
		});

		expect(disabled(tree, "Update balance")).toBe(true);
		press(tree, "1");
		press(tree, "9");
		press(tree, "Three zeros");
		await wait(400);
		const previews = calls.filter((c) => c.route === "preview");
		expect(previews.at(-1)?.input).toEqual({
			id: "acct-galicia",
			balance: "19000.00",
		});
		expect(calls.some((c) => c.route === "write")).toBe(false);
		expect(disabled(tree, "Update balance")).toBe(false);

		press(tree, "Update balance");
		await wait(50);
		const writes = calls.filter((c) => c.route === "write");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual({
			id: "acct-galicia",
			balance: "19000.00",
		});
		expect(writes[0]?.key).toMatch(/^00000000-0000-4000-8000-/);
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();

		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toContain("Galicia (ARS)");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-balance-1",
		});
		act(() => tree.unmount());
	});

	it("takes a real zero (an emptied account)", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<UpdateBalanceSheet
					account={account}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		press(tree, "0");
		await wait(400);
		expect(calls.at(-1)?.input).toEqual({
			id: "acct-galicia",
			balance: "0.00",
		});
		act(() => tree.unmount());
	});
});
