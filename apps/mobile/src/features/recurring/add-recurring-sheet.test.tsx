import type { RetrospendClient } from "@retrospend/api-client";
import { AddRecurringSheet } from "./AddRecurringSheet";

// Add a recurring expense with real presses: the dry run of the exact body
// comes first, Add stays off until it is in, the write carries the same body
// under one key, and the toast undoes it by deleting the new template.
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
	useSession: () => ({
		api: mockSession.api,
		state: {
			status: "signedIn",
			me: { homeCurrency: "USD", defaultCurrency: "USD" },
		},
	}),
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
jest.mock("@/ui/TextField", () => {
	const { Pressable } = require("react-native");
	return {
		FieldLabel: () => null,
		TextField: ({
			label,
			onChangeText,
		}: {
			label: string;
			onChangeText: (text: string) => void;
		}) => (
			<Pressable
				accessibilityLabel={label}
				onPress={() => onChangeText("  Streamly ")}
			/>
		),
	};
});
jest.mock("@/features/write/parts", () => {
	const { View } = require("react-native");
	return {
		...jest.requireActual("@/features/write/parts"),
		SheetBody: ({ children }: { children: unknown }) => <View>{children}</View>,
	};
});
jest.mock("@/ui/AmountField", () => {
	const { Pressable } = require("react-native");
	return {
		AmountField: ({
			onDraftChange,
		}: {
			onDraftChange: (draft: string) => void;
		}) => (
			<Pressable
				accessibilityLabel="Type amount"
				onPress={() => onDraftChange("12.50")}
			/>
		),
	};
});
jest.mock("@/features/activity/useCategories", () => ({
	useCategories: () => ({
		state: {
			status: "ready",
			data: [
				{ id: "c1", name: "Rent", kind: "expense", icon: null, tone: 1 },
				{ id: "c2", name: "Salary", kind: "income", icon: null, tone: 2 },
			],
		},
	}),
}));
jest.mock("@/features/entry/hooks", () => ({
	useEntryCatalog: () => ({
		status: "ready",
		stale: false,
		catalog: {
			categories: [],
			currencies: ["USD", "ARS"],
			recentCurrencies: [],
		},
	}),
}));
const mockPicked: { rows: { id: string }[] } = { rows: [] };
jest.mock("@/ui/PickField", () => ({
	PickField: ({ rows }: { rows: { id: string }[] }) => {
		mockPicked.rows = rows;
		return null;
	},
}));
jest.mock("@/ui/CurrencyPicker", () => ({ CurrencyPicker: () => null }));
jest.mock("@/ui/DateField", () => ({ DateField: () => null }));
jest.mock("@/ui/Segmented", () => ({ Segmented: () => null }));
jest.mock("@/ui/SwitchRow", () => ({ SwitchRow: () => null }));
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
		useLocale: () => "en",
	};
});

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
	return act(async () => {
		(hit.props.onPress as () => void)();
	});
}

function disabled(tree: Tree, label: string): boolean {
	const hit = tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];
	if (!hit) throw new Error(`nothing found: ${label}`);
	return (
		(hit.props.accessibilityState as { disabled?: boolean }).disabled === true
	);
}

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
});

describe("Add a recurring expense", () => {
	it("previews the exact body, writes it under one key, and undoes by deleting", async () => {
		const calls: { route: string; input: unknown; key?: string }[] = [];
		mockSession.api = {
			recurring: {
				previewCreate: async (input: unknown) => {
					calls.push({ route: "preview", input });
					return { changes: [], unchanged: [], unavailable: [] };
				},
				create: async (
					input: unknown,
					init?: { context?: { idempotencyKey?: string } },
				) => {
					calls.push({
						route: "write",
						input,
						key: init?.context?.idempotencyKey,
					});
					return { id: "tpl-new", title: "Streamly" };
				},
				delete: async (input: unknown) => {
					calls.push({ route: "delete", input });
					return { ok: true };
				},
			},
		} as unknown as RetrospendClient;
		const onDone = jest.fn();
		const onClose = jest.fn();
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<AddRecurringSheet onClose={onClose} onDone={onDone} visible />,
			);
		});
		// An expense template offers expense categories only.
		expect(mockPicked.rows.map((r) => r.id)).toEqual(["c1"]);
		// Nothing to preview until there is a name and an amount.
		expect(calls).toHaveLength(0);
		expect(disabled(tree, "Add")).toBe(true);
		await press(tree, "Name");
		await press(tree, "Type amount");
		await wait(400);
		const preview = calls.find((c) => c.route === "preview");
		expect(preview?.input).toMatchObject({
			name: "Streamly",
			amount: "12.50",
			currency: "USD",
			frequency: "MONTHLY",
			autoPay: false,
		});
		expect(disabled(tree, "Add")).toBe(false);

		await press(tree, "Add");
		const write = calls.find((c) => c.route === "write");
		expect(write?.input).toEqual(preview?.input);
		expect(write?.key).toBeTruthy();
		expect(onClose).toHaveBeenCalled();
		expect(onDone).toHaveBeenCalled();

		const toast = mockToast.show.mock.calls[0]?.[0];
		expect(toast.message).toBe("Streamly added");
		await act(async () => {
			await toast.undo.onUndo();
		});
		expect(calls.find((c) => c.route === "delete")?.input).toEqual({
			id: "tpl-new",
		});
		act(() => tree.unmount());
	});
});
