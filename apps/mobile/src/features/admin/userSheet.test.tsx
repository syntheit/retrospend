import { Alert } from "react-native";
import type { AdminUser } from "./types";
import { UserSheet } from "./UserSheet";

// Disabling or deleting an account asks first, then the device (or the typed
// email when the phone has no lock); disabling ends in an Undo toast that only
// undoes what is still true; your own account shows the facts and no actions.
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
	Sheet: ({ children, footer }: { children: unknown; footer?: unknown }) => (
		<>
			{children}
			{footer}
		</>
	),
	useSheetBodySize: () => ({ height: 600 }),
}));
jest.mock("@/ui/Picker", () => ({ Picker: () => null }));
jest.mock("@/ui/Button", () => {
	const { Pressable } = require("react-native");
	return {
		Button: ({ label, onPress, disabled }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				disabled={disabled as boolean}
				onPress={onPress as () => void}
			/>
		),
	};
});
const mockLevel = jest.fn();
const mockAuth = jest.fn();
jest.mock("expo-local-authentication", () => ({
	SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
	getEnrolledLevelAsync: () => mockLevel(),
	authenticateAsync: (options: unknown) => mockAuth(options),
}));
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
	name: "Sofía Reyes",
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

const gone = { ...sofia, isActive: false } as AdminUser;

async function open(readUser: () => Promise<AdminUser | null>) {
	const onChanged = jest.fn().mockResolvedValue(undefined);
	const onClose = jest.fn();
	let tree!: { root: TestNode; unmount(): void };
	await act(async () => {
		tree = create(
			<UserSheet
				isMe={false}
				onChanged={onChanged}
				onClose={onClose}
				readUser={readUser}
				user={sofia}
			/>,
		);
	});
	return { tree, onChanged, onClose };
}

async function pressDisableAndConfirm(tree: { root: TestNode }) {
	const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
	await act(async () => {
		const press = row(tree, "Disable account")?.props.onPress as
			| (() => void)
			| undefined;
		press?.();
	});
	const buttons = alert.mock.calls.at(-1)?.[2] as
		| { style?: string; onPress?: () => void }[]
		| undefined;
	return { alert, buttons };
}

describe("UserSheet", () => {
	beforeEach(() => {
		mockDisable.mockReset().mockResolvedValue({ ok: true });
		mockEnable.mockReset().mockResolvedValue({ ok: true });
		mockLevel.mockReset().mockResolvedValue(2);
		mockAuth.mockReset().mockResolvedValue({ success: true });
		mockToast.show.mockClear();
	});

	it("asks, then the device, before disabling; closes and offers Undo", async () => {
		const readUser = jest.fn().mockResolvedValue(gone);
		const { tree, onChanged, onClose } = await open(readUser);
		const { alert, buttons } = await pressDisableAndConfirm(tree);
		expect(alert).toHaveBeenCalledTimes(1);
		expect(mockAuth).not.toHaveBeenCalled();
		expect(mockDisable).not.toHaveBeenCalled();

		await act(async () => {
			buttons?.find((b) => b.style === "destructive")?.onPress?.();
		});
		expect(mockAuth).toHaveBeenCalledTimes(1);
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
		expect(toast.message).toBe("Sofía Reyes is disabled");

		await act(async () => {
			toast.undo.onUndo();
		});
		expect(readUser).toHaveBeenCalledWith("u1");
		expect(mockEnable).toHaveBeenCalledWith(
			{ id: "u1" },
			{ context: { idempotencyKey: "key-1" } },
		);
		alert.mockRestore();
		act(() => tree.unmount());
	});

	it("does not disable when the device check is cancelled", async () => {
		mockAuth.mockResolvedValue({ success: false });
		const { tree } = await open(jest.fn());
		const { alert, buttons } = await pressDisableAndConfirm(tree);
		await act(async () => {
			buttons?.find((b) => b.style === "destructive")?.onPress?.();
		});
		expect(mockAuth).toHaveBeenCalled();
		expect(mockDisable).not.toHaveBeenCalled();
		alert.mockRestore();
		act(() => tree.unmount());
	});

	it("leaves the account alone on Undo when someone changed it since", async () => {
		// The account is active again: it is no longer as the disable left it.
		const readUser = jest.fn().mockResolvedValue(sofia);
		const { tree } = await open(readUser);
		const { alert, buttons } = await pressDisableAndConfirm(tree);
		await act(async () => {
			buttons?.find((b) => b.style === "destructive")?.onPress?.();
		});
		const toast = mockToast.show.mock.calls.at(-1)?.[0] as {
			undo: { onUndo: () => void };
		};
		mockToast.show.mockClear();
		await act(async () => {
			toast.undo.onUndo();
		});
		expect(mockEnable).not.toHaveBeenCalled();
		expect(mockToast.show.mock.calls.at(-1)?.[0]).toEqual({
			message: "Sofía Reyes was changed since, so nothing was undone",
		});
		alert.mockRestore();
		act(() => tree.unmount());
	});

	it("asks for the email when the phone has no screen lock", async () => {
		mockLevel.mockResolvedValue(0);
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		const { tree } = await open(jest.fn());
		await act(async () => {
			const press = row(tree, "Delete user")?.props.onPress as
				| (() => void)
				| undefined;
			press?.();
		});
		await act(async () => {});
		expect(alert).not.toHaveBeenCalled();
		expect(mockAuth).not.toHaveBeenCalled();

		const confirm = () =>
			tree.root.findAll((n) => n.props.accessibilityLabel === "Delete user")[0];
		expect(confirm()?.props.disabled).toBe(true);
		const input = tree.root.findAll(
			(n) => typeof n.props.onChangeText === "function",
		)[0];
		const change = input?.props.onChangeText as
			| ((text: string) => void)
			| undefined;
		const type = (text: string) => change?.(text);
		act(() => type("nope@x.io"));
		expect(confirm()?.props.disabled).toBe(true);
		act(() => type(" Sofia@Example.com "));
		expect(confirm()?.props.disabled).toBe(false);
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
					readUser={jest.fn()}
					user={sofia}
				/>,
			);
		});
		expect(row(tree, "Disable account")).toBeUndefined();
		expect(row(tree, "Delete user")).toBeUndefined();
		act(() => tree.unmount());
	});
});
