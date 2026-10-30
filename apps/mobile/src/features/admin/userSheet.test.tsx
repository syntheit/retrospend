import { Alert } from "react-native";
import type { AdminUser } from "./types";
import { UserSheet } from "./UserSheet";

// Disabling an account asks first and ends in an Undo toast; your own account
// shows the facts and no actions.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	children: (TestNode | string)[];
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockDisable = jest.fn();
const mockEnable = jest.fn();
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: {
			admin: { disableUser: mockDisable, enableUser: mockEnable },
		},
	}),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("@/ui/Sheet", () => ({
	Sheet: ({ children }: { children: unknown }) => children,
	useSheetBodySize: () => ({ height: 600 }),
}));
jest.mock("@/ui/Picker", () => ({ Picker: () => null }));
jest.mock("use-intl", () => {
	const { loadMessages } = require("@/lib/i18n");
	const messages = loadMessages("en");
	const lookup = (ns: string | undefined, key: string) =>
		(ns ? `${ns}.${key}` : key)
			.split(".")
			// biome-ignore lint/suspicious/noExplicitAny: a walk over the JSON tree
			.reduce((node: any, part: string) => node?.[part], messages);
	return {
		useFormatter: () => ({ dateTime: () => "Jan 1, 2026" }),
		useTranslations:
			(ns?: string) =>
			(key: string, values: Record<string, unknown> = {}) =>
				String(lookup(ns, key) ?? key).replace(/\{(\w+)\}/g, (_, name) =>
					String(values[name]),
				),
	};
});

const sofia = {
	id: "u1",
	username: "sofia",
	email: "sofia@example.com",
	emailVerified: true,
	twoFactorEnabled: false,
	role: "USER",
	isActive: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	expenseCount: 3,
	inviteCodesCount: 0,
	lastExpenseDate: "2026-10-28",
	hasBudget: false,
	hasRecurring: false,
	hasWealth: false,
	externalAiAllowed: null,
} as AdminUser;

function textOf(node: TestNode | string): string {
	if (typeof node === "string") return node;
	return node.children.map(textOf).join("");
}

const row = (tree: { root: TestNode }, title: string) =>
	tree.root.findAll(
		(n) => typeof n.props.onPress === "function" && textOf(n).includes(title),
	)[0];

describe("UserSheet", () => {
	beforeEach(() => {
		mockDisable.mockReset().mockResolvedValue({ ok: true });
		mockEnable.mockReset().mockResolvedValue({ ok: true });
		mockToast.show.mockClear();
	});

	it("asks before disabling, then disables, closes and offers Undo", async () => {
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		const onChanged = jest.fn().mockResolvedValue(undefined);
		const onClose = jest.fn();
		let tree!: { root: TestNode; unmount(): void };
		await act(async () => {
			tree = create(
				<UserSheet
					isMe={false}
					onChanged={onChanged}
					onClose={onClose}
					user={sofia}
				/>,
			);
		});
		await act(async () => {
			const press = row(tree, "Disable account")?.props.onPress as
				| (() => void)
				| undefined;
			press?.();
		});
		expect(alert).toHaveBeenCalledTimes(1);
		expect(mockDisable).not.toHaveBeenCalled();

		const buttons = alert.mock.calls[0]?.[2] as {
			style?: string;
			onPress?: () => void;
		}[];
		await act(async () => {
			buttons.find((b) => b.style === "destructive")?.onPress?.();
		});
		expect(mockDisable).toHaveBeenCalledWith(
			{ id: "u1" },
			{ context: { idempotencyKey: "key-1" } },
		);
		expect(onChanged).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
		const toast = mockToast.show.mock.calls.at(-1)?.[0] as {
			message: string;
			undo: { onUndo: () => void };
		};
		expect(toast.message).toBe("sofia is disabled");

		await act(async () => {
			toast.undo.onUndo();
		});
		expect(mockEnable).toHaveBeenCalledWith(
			{ id: "u1" },
			{ context: { idempotencyKey: "key-1" } },
		);
		alert.mockRestore();
		act(() => tree.unmount());
	});

	it("offers no actions on your own account", async () => {
		let tree!: { root: TestNode; unmount(): void };
		await act(async () => {
			tree = create(
				<UserSheet
					isMe
					onChanged={jest.fn()}
					onClose={jest.fn()}
					user={sofia}
				/>,
			);
		});
		expect(row(tree, "Disable account")).toBeUndefined();
		expect(row(tree, "Delete account")).toBeUndefined();
		act(() => tree.unmount());
	});
});
