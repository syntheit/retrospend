import type { RetrospendClient } from "@retrospend/api-client";
import type { ActivityItem } from "@/features/activity/source";
import { MakeRecurringSheet } from "./MakeRecurringSheet";

// Make an expense repeat with real presses: a retry after a lost answer sends
// the same idempotency key (one template), and a create the server confirmed
// retires its key so the next one is a new template.
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

const item = {
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Streamly",
	category: null,
	amount: { minor: 1000, currency: "USD" },
	sortKey: 1000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
} as unknown as ActivityItem;

function fakeApi(failFirst: boolean) {
	const keys: (string | undefined)[] = [];
	let n = 0;
	const api = {
		recurring: {
			create: async (
				_input: unknown,
				init?: { context?: { idempotencyKey?: string } },
			) => {
				keys.push(init?.context?.idempotencyKey);
				n += 1;
				if (failFirst && n === 1) throw new Error("lost");
				return { id: `tpl-${n}` };
			},
			delete: async () => ({}),
		},
	} as unknown as RetrospendClient;
	return { api, keys };
}

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

beforeEach(() => {
	mockIdCounter = 0;
	mockToast.show.mockClear();
});

describe("Make an expense repeat", () => {
	it("sends one key for a retry after a lost answer", async () => {
		const { api, keys } = fakeApi(true);
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<MakeRecurringSheet
					item={item}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await press(tree, "Make recurring");
		await press(tree, "Make recurring");
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBe(keys[0]);
		act(() => tree.unmount());
	});

	it("uses a new key once the create was confirmed", async () => {
		const { api, keys } = fakeApi(false);
		mockSession.api = api;
		let tree!: Tree;
		await act(async () => {
			tree = create(
				<MakeRecurringSheet
					item={item}
					onClose={jest.fn()}
					onDone={jest.fn()}
					visible
				/>,
			);
		});
		await press(tree, "Make recurring");
		await press(tree, "Make recurring");
		expect(keys).toHaveLength(2);
		expect(keys[1]).not.toBe(keys[0]);
		act(() => tree.unmount());
	});
});
