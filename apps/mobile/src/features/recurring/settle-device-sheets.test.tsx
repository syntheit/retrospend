import type { RetrospendClient } from "@retrospend/api-client";
import { createOutbox, type Outbox } from "@/data/outbox";
import { createMemoryStore } from "@/data/store";
import { forgetUndoTokens } from "@/features/entry/send";
import { forgetSent } from "@/features/entry/sentRetain";
import { ConfirmSheet } from "./ConfirmSheet";
import { SkipSheet } from "./SkipSheet";
import type { RecurringItem } from "./source";

// The sheets under the dev flag, with real presses: the device books the
// confirm or skip and queues it, the sheet still shows the server's dry run,
// offline Save waits on the phone, and the toast undoes it. With the flag off,
// or for income, the write goes straight to API v1 and the outbox is never
// touched.
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

const mockSession: { api: unknown; local: { outbox: Outbox } | null } = {
	api: undefined,
	local: null,
};
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: mockSession.api, local: mockSession.local }),
}));
const mockWrites = jest.fn();
jest.mock("@/data/deviceWrites", () => ({ deviceWrites: () => mockWrites() }));
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
jest.mock("@/ui/DateField", () => {
	const { Pressable } = require("react-native");
	return {
		DateField: ({
			label,
			onChange,
			minimum,
			today,
			value,
		}: {
			label: string;
			onChange: (picked: string) => void;
			minimum?: string;
			today?: string;
			value: string;
		}) => (
			<>
				<Pressable
					accessibilityHint={`${minimum} ${value}`}
					accessibilityLabel={label}
					onPress={() => onChange("2026-11-03")}
				/>
				<Pressable
					accessibilityLabel="Today"
					onPress={() => onChange(today as string)}
				/>
			</>
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

const STAMP = "2026-10-20T10:00:00.000Z";
const NEXT = "2026-11-20T10:00:00.000Z";
const DUE = "2026-11-01T12:00:00.000Z";

const item = {
	id: "rec-netflix",
	title: "Netflix",
	amountMode: "fixed",
	direction: "out",
	amount: { minor: 1599, currency: "USD" },
	next: "2026-11-01",
	nextAfter: "2026-12-01",
	paidOnFrom: "2026-10-01",
	dueAt: DUE,
	updatedAt: STAMP,
} as unknown as RecurringItem;

const network = () => new Error("Network request failed");

function setup() {
	const calls: { route: string; input: unknown; key?: string }[] = [];
	const recurring = {
		previewConfirm: jest.fn(async (input: unknown) => {
			calls.push({ route: "previewConfirm", input });
			return { changes: [], unchanged: [], unavailable: [] };
		}),
		previewSkip: jest.fn(async (input: unknown) => {
			calls.push({ route: "previewSkip", input });
			return { changes: [], unchanged: [], unavailable: [] };
		}),
		confirm: jest.fn(
			async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "confirm",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { undo: "tok-c", confirmed: { templateUpdatedAt: NEXT } };
			},
		),
		skip: jest.fn(
			async (
				input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				calls.push({
					route: "skip",
					input,
					key: init?.context?.idempotencyKey,
				});
				return { undo: "tok-s", skipped: { templateUpdatedAt: NEXT } };
			},
		),
		undo: jest.fn(async (input: unknown) => {
			calls.push({ route: "undo", input });
			return {};
		}),
		undoSkip: jest.fn(async (input: unknown) => {
			calls.push({ route: "undoSkip", input });
			return {};
		}),
	};
	const writes = {
		book: jest.fn(async () => ({
			bookedAt: 1,
			changes: [],
			changed: [],
			base: STAMP,
		})),
		comparePreview: jest.fn(async () => undefined),
		refresh: jest.fn(async () => undefined),
		pullsBegun: () => 1,
	};
	const outbox = createOutbox(createMemoryStore(), "scope");
	mockSession.api = { recurring } as unknown as RetrospendClient;
	mockSession.local = { outbox };
	mockWrites.mockReturnValue(writes);
	return { calls, recurring, writes, outbox };
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

function disabled(tree: Tree, label: string) {
	const hit = tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.accessibilityState === "object",
	)[0];
	return (hit?.props.accessibilityState as { disabled: boolean } | undefined)
		?.disabled;
}

async function openConfirm(
	over: Partial<RecurringItem> = {},
	today = "2026-11-01",
) {
	let tree!: Tree;
	const onDone = jest.fn();
	const onClose = jest.fn();
	await act(async () => {
		tree = create(
			<ConfirmSheet
				item={{ ...item, ...over } as RecurringItem}
				onClose={onClose}
				onDone={onDone}
				onSkip={jest.fn()}
				today={today}
				visible
			/>,
		);
	});
	await wait(400);
	return { tree, onDone, onClose };
}

async function openSkip(over: Partial<RecurringItem> = {}) {
	let tree!: Tree;
	const onDone = jest.fn();
	await act(async () => {
		tree = create(
			<SkipSheet
				item={{ ...item, ...over } as RecurringItem}
				onClose={jest.fn()}
				onDone={onDone}
				visible
			/>,
		);
	});
	await wait(400);
	return { tree, onDone };
}

const textOf = (tree: Tree) =>
	JSON.stringify(
		tree.root
			.findAll((n) => typeof n.props.children === "string")
			.map((n) => n.props.children),
	);

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
	mockWrites.mockReset().mockReturnValue(null);
	mockSession.local = null;
	forgetUndoTokens();
	forgetSent();
});

describe("Confirm under the dev flag", () => {
	it("shows the server's dry run, books on the device, and sends one stamped confirm under the sheet's key", async () => {
		const { calls, writes, recurring, outbox } = setup();
		const { tree, onClose, onDone } = await openConfirm();
		expect(recurring.previewConfirm).toHaveBeenCalledTimes(1);
		expect(writes.comparePreview).toHaveBeenCalledTimes(1);

		press(tree, "Log expense");
		await wait(100);
		const sent = calls.filter((c) => c.route === "confirm");
		expect(sent).toHaveLength(1);
		const key = sent[0]?.key as string;
		expect(key).toMatch(/^00000000-0000-4000-8000-/);
		// The expense takes the entry's id; the stamp is the version the screen read.
		expect(sent[0]?.input).toEqual({
			id: "rec-netflix",
			dueAt: DUE,
			expectedUpdatedAt: STAMP,
			expenseId: key,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "confirm",
			body: { templateId: "rec-netflix", dueAt: DUE, expenseId: key },
		});
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
			token: "tok-c",
		});
		expect(await outbox.all()).toEqual([]);
		act(() => tree.unmount());
	});

	it("waits on the phone when offline: Save is on without a dry run, and the entry stays in the outbox", async () => {
		const { recurring, outbox } = setup();
		recurring.previewConfirm.mockRejectedValue(network());
		recurring.confirm.mockRejectedValue(network());
		const { tree } = await openConfirm();
		expect(disabled(tree, "Log expense")).toBe(false);
		expect(textOf(tree)).toContain(
			"You're offline. This saves on your phone and syncs later.",
		);

		press(tree, "Log expense");
		await wait(100);
		const entries = await outbox.all();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			entity: "recurring",
			kind: "confirm",
			targetId: "rec-netflix",
			baseVersion: STAMP,
			payload: { dueAt: DUE, title: "Netflix" },
		});
		const toast = mockToast.show.mock.calls[0]?.[0] as { message: string };
		expect(toast.message).toBe(
			"Saved Netflix on this phone. It syncs when you're online.",
		);
		act(() => tree.unmount());
	});

	it("a server error while online keeps Save off and the error line, with no offline note", async () => {
		const { recurring } = setup();
		recurring.previewConfirm.mockRejectedValue(
			Object.assign(new Error("boom"), { status: 503, code: "unavailable" }),
		);
		const { tree } = await openConfirm();
		expect(disabled(tree, "Log expense")).toBe(true);
		expect(textOf(tree)).not.toContain("You're offline");
		expect(textOf(tree)).toContain("Couldn't check this. Try again.");
		act(() => tree.unmount());
	});

	it("keeps Save off when the server refuses the dry run", async () => {
		const { recurring } = setup();
		recurring.previewConfirm.mockRejectedValue(
			Object.assign(new Error("no"), {
				status: 409,
				code: "recurring_changed",
			}),
		);
		const { tree } = await openConfirm();
		expect(disabled(tree, "Log expense")).toBe(true);
		act(() => tree.unmount());
	});

	it("books a varying amount and a paid-on day on the device and sends both", async () => {
		const { calls, writes } = setup();
		const { tree } = await openConfirm(
			{ amountMode: "ask" } as never,
			"2026-11-05",
		);
		// The mocked date field picks Nov 3, two days after the due date.
		press(tree, "Paid on");
		await wait(450);
		press(tree, "Log expense");
		await wait(100);
		const sent = calls.find((c) => c.route === "confirm");
		expect(sent?.input).toMatchObject({
			amount: "15.99",
			paidOn: "2026-11-03",
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "confirm",
			body: {
				templateId: "rec-netflix",
				dueAt: DUE,
				expenseId: sent?.key,
				amount: "15.99",
				paidOn: "2026-11-03",
			},
		});
		act(() => tree.unmount());
	});

	it("income stays on the server: no booking, nothing queued, the plain v1 write", async () => {
		const { calls, writes, outbox } = setup();
		const { tree } = await openConfirm({ direction: "in" } as never);
		press(tree, "Log income");
		await wait(100);
		expect(calls.find((c) => c.route === "confirm")?.input).toEqual({
			id: "rec-netflix",
			dueAt: DUE,
		});
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.comparePreview).not.toHaveBeenCalled();
		expect(await outbox.all()).toEqual([]);
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
		act(() => tree.unmount());
	});
});

describe("Skip under the dev flag", () => {
	it("books on the device and sends one stamped skip, and Undo goes through the skip route", async () => {
		const { calls, writes } = setup();
		const { tree, onDone } = await openSkip();
		press(tree, "Skip");
		await wait(100);
		const sent = calls.filter((c) => c.route === "skip");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.input).toEqual({
			id: "rec-netflix",
			dueAt: DUE,
			expectedUpdatedAt: STAMP,
		});
		expect(writes.book).toHaveBeenCalledWith({
			kind: "skip",
			body: { templateId: "rec-netflix", dueAt: DUE },
		});
		expect(onDone).toHaveBeenCalled();
		const toast = mockToast.show.mock.calls[0]?.[0] as {
			message: string;
			undo: { onUndo: () => Promise<void> };
		};
		expect(toast.message).toBe("Skipped Netflix. Next due 2026-12-01");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "undoSkip")?.input).toEqual({
			token: "tok-s",
		});
		expect(calls.some((c) => c.route === "undo")).toBe(false);
		act(() => tree.unmount());
	});

	it("a server error while online keeps Skip off, with no offline note", async () => {
		const { recurring } = setup();
		recurring.previewSkip.mockRejectedValue(
			Object.assign(new Error("boom"), { status: 503, code: "unavailable" }),
		);
		const { tree } = await openSkip();
		expect(disabled(tree, "Skip")).toBe(true);
		expect(textOf(tree)).not.toContain("You're offline");
		act(() => tree.unmount());
	});

	it("waits on the phone when offline", async () => {
		const { recurring, outbox } = setup();
		recurring.previewSkip.mockRejectedValue(network());
		recurring.skip.mockRejectedValue(network());
		const { tree } = await openSkip();
		expect(disabled(tree, "Skip")).toBe(false);
		press(tree, "Skip");
		await wait(100);
		expect((await outbox.all())[0]).toMatchObject({
			kind: "skip",
			baseVersion: STAMP,
		});
		act(() => tree.unmount());
	});
});

describe("with the flag off", () => {
	it("confirm and skip go straight to API v1: no engine call, no outbox entry, the bodies as ever", async () => {
		const { calls, writes, outbox } = setup();
		mockWrites.mockReturnValue(null);
		const confirmed = await openConfirm();
		press(confirmed.tree, "Log expense");
		await wait(100);
		act(() => confirmed.tree.unmount());
		const skipped = await openSkip();
		press(skipped.tree, "Skip");
		await wait(100);
		act(() => skipped.tree.unmount());
		const body = { id: "rec-netflix", dueAt: DUE };
		expect(calls.find((c) => c.route === "confirm")?.input).toEqual(body);
		expect(calls.find((c) => c.route === "skip")?.input).toEqual(body);
		expect(writes.book).not.toHaveBeenCalled();
		expect(writes.comparePreview).not.toHaveBeenCalled();
		expect(await outbox.snapshot()).toEqual({ open: [], acked: [] });
	});
});
