import { DeleteAccountSheet } from "./DeleteAccountSheet";

// Deleting the account sends the helper's secret as the password, stops with
// the refusal's words when the helper refuses, and forgets the keyed record
// once the account is gone.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockDelete = jest.fn();
const mockSignOut = jest.fn();
const mockResolve = jest.fn();
const mockForget = jest.fn();
const mockApi = {
	account: {
		deletionPreview: async () => ({
			projectsToHandOver: [],
			projectsToDelete: [],
			settlementsToAutoConfirm: 0,
			settlementsToCancel: 0,
			verificationsToAutoAccept: 0,
			sharedTransactionsToAnonymize: 0,
		}),
		delete: mockDelete,
	},
};
const mockState = {
	current: { status: "signedIn", me: { email: "ana@example.com" } } as {
		status: string;
		me: { email: string } | null;
	},
};
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: mockApi,
		baseUrl: "https://retrospend.app",
		state: mockState.current,
		signOut: mockSignOut,
	}),
}));
jest.mock("@/auth/sign-in-secret", () => ({
	keysLookup: () => "lookup",
	resolveSignInSecret: (...args: unknown[]) => mockResolve(...args),
	forgetKeyed: (...args: unknown[]) => mockForget(...args),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));
jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("./deleteLines", () => ({ projectLines: () => [] }));
jest.mock("@/ui/Text", () => {
	const { Text } = require("react-native");
	return {
		Text: (props: { children?: unknown }) => <Text>{props.children}</Text>,
	};
});
jest.mock("@/ui/Sheet", () => {
	const { View } = require("react-native");
	return {
		useSheetBodySize: () => ({ height: 400 }),
		Sheet: ({
			children,
			footer,
			visible,
		}: {
			children: unknown;
			footer: unknown;
			visible: boolean;
		}) =>
			visible ? (
				<View>
					{children}
					{footer}
				</View>
			) : null,
	};
});
jest.mock("@/ui/TextField", () => {
	const { TextInput } = require("react-native");
	return {
		TextField: (props: {
			label: string;
			value: string;
			onChangeText(v: string): void;
		}) => (
			<TextInput
				onChangeText={props.onChangeText}
				testID="password"
				value={props.value}
			/>
		),
	};
});
jest.mock("@/ui/Button", () => {
	const { Pressable, Text } = require("react-native");
	return {
		Button: (props: { label: string; variant?: string; onPress(): void }) => (
			<Pressable onPress={props.onPress} testID={`button:${props.variant}`}>
				<Text>{props.label}</Text>
			</Pressable>
		),
	};
});
jest.mock("use-intl", () => {
	const { loadMessages } = require("@/lib/i18n");
	const messages = loadMessages("en");
	const lookup = (ns: string | undefined, key: string) =>
		(ns ? `${ns}.${key}` : key)
			.split(".")
			// biome-ignore lint/suspicious/noExplicitAny: a walk over the JSON tree
			.reduce((node: any, part: string) => node?.[part], messages);
	return {
		useTranslations: (ns?: string) => (key: string) =>
			String(lookup(ns, key) ?? key),
	};
});

async function render() {
	let root: { root: TestNode } | undefined;
	await act(async () => {
		root = create(<DeleteAccountSheet onClose={jest.fn()} visible />);
	});
	if (!root) throw new Error("not rendered");
	const tree = root.root;
	const byId = (id: string) =>
		tree.findAll((n) => n.props.testID === id)[0] as TestNode;
	await act(async () => {
		(byId("password").props.onChangeText as (v: string) => void)("typed pw");
	});
	const remove = async () => {
		await act(async () => {
			await (byId("button:danger").props.onPress as () => Promise<void>)();
		});
	};
	const texts = () =>
		tree
			.findAll((n) => typeof n.props.children === "string")
			.map((n) => n.props.children as string);
	return { remove, texts };
}

beforeEach(() => {
	for (const m of [mockDelete, mockSignOut, mockResolve, mockForget])
		m.mockReset();
	mockState.current = { status: "signedIn", me: { email: "ana@example.com" } };
	mockDelete.mockResolvedValue({ ok: true });
	mockForget.mockResolvedValue(undefined);
});

describe("DeleteAccountSheet", () => {
	it("sends the sign-in secret, not the typed password, then forgets the record", async () => {
		mockResolve.mockResolvedValue({ ok: true, secret: "SECRET" });
		const s = await render();
		await s.remove();
		expect(mockResolve).toHaveBeenCalledWith({
			baseUrl: "https://retrospend.app",
			email: "ana@example.com",
			password: "typed pw",
			lookup: "lookup",
		});
		expect(mockDelete).toHaveBeenCalledWith(
			{ password: "SECRET" },
			{ context: { idempotencyKey: "key-1" } },
		);
		expect(mockForget).toHaveBeenCalledWith(
			"https://retrospend.app",
			"ana@example.com",
		);
		expect(mockSignOut).toHaveBeenCalled();
	});

	it("deletes nothing and says why when the helper refuses", async () => {
		mockResolve.mockResolvedValue({ ok: false, reason: "protectionRefused" });
		const s = await render();
		await s.remove();
		expect(mockDelete).not.toHaveBeenCalled();
		expect(s.texts()).toContain(
			"The server's answer about this account's protection looks wrong. Nothing was deleted.",
		);
	});
});

describe("DeleteAccountSheet without a profile", () => {
	it("says it could not delete and sends nothing", async () => {
		mockState.current = { status: "signedIn", me: null };
		const s = await render();
		await s.remove();
		expect(mockResolve).not.toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
		expect(s.texts()).toContain(
			"Couldn't delete the account. Check your password and try again.",
		);
	});
});
