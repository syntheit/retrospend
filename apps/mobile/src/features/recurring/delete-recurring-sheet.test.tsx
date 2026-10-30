import type { RetrospendClient } from "@retrospend/api-client";
import { DeleteRecurringSheet } from "./DeleteRecurringSheet";
import type { RecurringItem } from "./source";

// Delete with real presses: the dry run comes first and says what stops, the
// button stays off until it is in, the write runs under one idempotency key,
// and the toast puts the template back with the delete undo token.
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
	Sheet: ({
		visible,
		children,
		footer,
	}: {
		visible: boolean;
		children: unknown;
		footer: unknown;
	}) =>
		visible ? (
			<>
				{children}
				{footer}
			</>
		) : null,
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

const item = {
	id: "rec-netflix",
	title: "Netflix",
	autoPay: true,
	next: "2026-11-01",
} as unknown as RecurringItem;

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

describe("Delete a recurring expense", () => {
	it("previews, deletes under one key, and undoes with the delete token", async () => {
		const calls: { route: string; input: unknown; key?: string }[] = [];
		mockSession.api = {
			recurring: {
				previewDelete: async (input: unknown) => {
					calls.push({ route: "preview", input });
					return { changes: [], unchanged: [], unavailable: [] };
				},
				delete: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({
						route: "write",
						input,
						key: init?.context?.idempotencyKey,
					});
					return { ok: true, undo: "undo-delete-1" };
				},
				undoDelete: async (input: unknown) => {
					calls.push({ route: "undoDelete", input });
					return {};
				},
			},
		} as unknown as RetrospendClient;
		const onDone = jest.fn();
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<DeleteRecurringSheet
					item={item}
					onClose={onClose}
					onDone={onDone}
					visible
				/>,
			);
		});
		// The button waits for the dry run.
		expect(
			tree.root.findAll(
				(n) => n.props.accessibilityLabel === "Delete recurring expense",
			)[0]?.props.accessibilityState,
		).toEqual({ disabled: true });
		await wait(400);
		expect(calls.find((c) => c.route === "preview")?.input).toEqual({
			id: "rec-netflix",
		});
		expect(calls.some((c) => c.route === "write")).toBe(false);

		press(tree, "Delete recurring expense");
		await wait(50);
		const writes = calls.filter((c) => c.route === "write");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual({ id: "rec-netflix" });
		expect(writes[0]?.key).toMatch(/^00000000-0000-4000-8000-/);
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();

		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toBe("Netflix deleted");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undoDelete")?.input).toEqual({
			token: "undo-delete-1",
		});
		act(() => tree.unmount());
	});
});
