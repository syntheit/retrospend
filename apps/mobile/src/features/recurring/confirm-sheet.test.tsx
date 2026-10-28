import type { RetrospendClient } from "@retrospend/api-client";
import { ConfirmSheet } from "./ConfirmSheet";
import type { RecurringItem } from "./source";

// Confirm with real presses: the dry run comes first, the write carries the
// item's due instant as its guard under one idempotency key, and the toast
// undoes it with the recurring undo token.
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
		useFormatter: () => ({
			dateTime: (date: Date) => date.toISOString().slice(0, 10),
		}),
	};
});

const usd = (minor: number) => ({ minor, currency: "USD" });

const item = {
	id: "rec-netflix",
	title: "Netflix",
	amountMode: "fixed",
	direction: "out",
	amount: usd(1599),
	next: "2026-11-01",
	nextAfter: "2026-12-01",
	dueAt: "2026-11-01T12:00:00.000Z",
} as unknown as RecurringItem;

function fakeApi() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const api = {
		recurring: {
			previewConfirm: async (input: unknown) => {
				calls.push({ route: "preview", input });
				return { changes: [], unchanged: [], unavailable: [] };
			},
			confirm: async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "write",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { confirmed: {}, undo: "undo-rec-1" };
			},
			undo: async (input: unknown) => {
				calls.push({ route: "undo", input });
				return { expenseId: "e", templateId: "t", redo: null };
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

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
});

describe("Confirm a recurring expense", () => {
	it("previews with the due guard, writes under one key, and undoes with the token", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onDone = jest.fn();
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet item={item} onClose={onClose} onDone={onDone} visible />,
			);
		});
		await wait(400);
		const body = { id: "rec-netflix", dueAt: "2026-11-01T12:00:00.000Z" };
		expect(calls.find((c) => c.route === "preview")?.input).toEqual(body);
		expect(calls.some((c) => c.route === "write")).toBe(false);

		press(tree, "Confirm");
		await wait(50);
		const writes = calls.filter((c) => c.route === "write");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual(body);
		expect(writes[0]?.key).toMatch(/^00000000-0000-4000-8000-/);
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();

		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toContain("Netflix");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undo")?.input).toEqual({
			token: "undo-rec-1",
		});
		act(() => tree.unmount());
	});
});
