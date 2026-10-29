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
jest.mock("@/ui/DateField", () => {
	const { Pressable } = require("react-native");
	return {
		DateField: ({
			label,
			onChange,
			minimum,
		}: {
			label: string;
			onChange: (picked: string) => void;
			minimum?: string;
		}) => (
			<Pressable
				accessibilityHint={minimum}
				accessibilityLabel={label}
				onPress={() => onChange("2026-11-03")}
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
	paidOnFrom: "2026-10-01",
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
				<ConfirmSheet
					item={item}
					onClose={onClose}
					onDone={onDone}
					onSkip={jest.fn()}
					today="2026-11-01"
					visible
				/>,
			);
		});
		await wait(400);
		const body = { id: "rec-netflix", dueAt: "2026-11-01T12:00:00.000Z" };
		expect(calls.find((c) => c.route === "preview")?.input).toEqual(body);
		expect(calls.some((c) => c.route === "write")).toBe(false);

		press(tree, "Log expense");
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

	it("does not touch auto-pay: no switch, no second write", async () => {
		const { api, calls } = fakeApi();
		(api.recurring as unknown as Record<string, unknown>).update = async (
			input: unknown,
		) => {
			calls.push({ route: "update", input });
			return {};
		};
		mockSession.api = api;
		const withAutoPay = { ...item, autoPay: true } as RecurringItem;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={withAutoPay}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={jest.fn()}
					today="2026-11-01"
					visible
				/>,
			);
		});
		await wait(400);
		expect(tree.root.findAll((n) => n.props.label === "Auto-pay")).toHaveLength(
			0,
		);
		press(tree, "Log expense");
		await wait(50);
		expect(calls.some((c) => c.route === "update")).toBe(false);
		act(() => tree.unmount());
	});

	it("starts a varying amount at the usual one and sends it with the confirm", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const asking = { ...item, amountMode: "ask" } as RecurringItem;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={asking}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={jest.fn()}
					today="2026-11-01"
					visible
				/>,
			);
		});
		await wait(400);
		expect(calls.find((c) => c.route === "preview")?.input).toEqual({
			id: "rec-netflix",
			dueAt: "2026-11-01T12:00:00.000Z",
			amount: "15.99",
		});
		act(() => tree.unmount());
	});

	it("sends the day it was paid, and only when it is not the due date", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={item}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={jest.fn()}
					today="2026-11-04"
					visible
				/>,
			);
		});
		await wait(400);
		const previews = () => calls.filter((c) => c.route === "preview");
		expect(previews().at(-1)?.input).toEqual({
			id: "rec-netflix",
			dueAt: "2026-11-01T12:00:00.000Z",
		});

		press(tree, "Today");
		await wait(400);
		const body = {
			id: "rec-netflix",
			dueAt: "2026-11-01T12:00:00.000Z",
			paidOn: "2026-11-04",
		};
		expect(previews().at(-1)?.input).toEqual(body);

		press(tree, "Pick a date");
		await wait(50);
		press(tree, "Date");
		await wait(400);
		expect(previews().at(-1)?.input).toEqual({ ...body, paidOn: "2026-11-03" });

		press(tree, "Log expense");
		await wait(50);
		const writes = calls.filter((c) => c.route === "write");
		expect(writes).toHaveLength(1);
		expect(writes[0]?.input).toEqual({ ...body, paidOn: "2026-11-03" });
		act(() => tree.unmount());
	});

	it("gives the date field the earliest day and writes nothing before it", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const early = { ...item, paidOnFrom: "2026-11-04" } as RecurringItem;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={early}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={jest.fn()}
					today="2026-11-04"
					visible
				/>,
			);
		});
		await wait(400);
		press(tree, "Pick a date");
		await wait(50);
		const field = tree.root.findAll(
			(n) => n.props.accessibilityLabel === "Date",
		);
		expect(field[0]?.props.accessibilityHint).toBe("2026-11-04");
		const before = calls.filter((c) => c.route === "preview").length;
		press(tree, "Date");
		await wait(400);
		// 2026-11-03 is before the earliest day: no new dry run, and Confirm is off.
		expect(calls.filter((c) => c.route === "preview")).toHaveLength(before);
		const confirm = tree.root.findAll(
			(n) => n.props.accessibilityLabel === "Log expense",
		)[0];
		expect(confirm?.props.accessibilityState).toEqual({ disabled: true });
		act(() => tree.unmount());
	});

	it("names the verb after the direction: Log income for an income template", async () => {
		const { api } = fakeApi();
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={{ ...item, direction: "in" } as RecurringItem}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={jest.fn()}
					today="2026-11-01"
					visible
				/>,
			);
		});
		await wait(400);
		const labels = (name: string) =>
			tree.root.findAll((n) => n.props.accessibilityLabel === name);
		expect(labels("Log income").length).toBeGreaterThan(0);
		expect(labels("Log expense")).toHaveLength(0);
		act(() => tree.unmount());
	});

	it("hands over to the skip sheet without writing", async () => {
		const { api, calls } = fakeApi();
		mockSession.api = api;
		const onSkip = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<ConfirmSheet
					item={item}
					onClose={jest.fn()}
					onDone={jest.fn()}
					onSkip={onSkip}
					today="2026-11-01"
					visible
				/>,
			);
		});
		await wait(400);
		press(tree, "Skip this time");
		expect(onSkip).toHaveBeenCalledTimes(1);
		expect(calls.some((c) => c.route === "write")).toBe(false);
		act(() => tree.unmount());
	});
});
