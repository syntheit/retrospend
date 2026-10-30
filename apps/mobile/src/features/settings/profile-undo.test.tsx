import { ProfileSection } from "./ProfileSection";

// Undo of a name change: when the server refuses the undo, the field shows
// the name the server still has and a toast says it did not work.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockUpdate = jest.fn();
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		api: { profile: { update: mockUpdate } },
		refreshMe: jest.fn(),
	}),
}));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({
		connection: { status: "connected", baseUrl: "https://x.test" },
	}),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("./BackgroundSheet", () => ({ BackgroundSheet: () => null }));
jest.mock("./webPages", () => ({ openWebPage: jest.fn() }));
jest.mock("./useAvatar", () => ({
	useAvatar: () => ({ busy: null, pick: jest.fn(), confirmRemove: jest.fn() }),
}));
jest.mock("./useSettings", () => ({
	useProfile: () => ({
		state: {
			status: "ready",
			data: {
				id: "u1",
				name: "Sofia",
				username: "sofia",
				email: "s@example.com",
				avatarUrl: null,
				pendingEmail: null,
			},
		},
		reload: jest.fn(),
	}),
}));
jest.mock("@/ui/Button", () => {
	const { Pressable } = require("react-native");
	return {
		Button: ({ label, onPress }: Record<string, unknown>) => (
			<Pressable
				accessibilityLabel={label as string}
				onPress={onPress as () => void}
			/>
		),
	};
});
jest.mock("@/ui/Avatar", () => ({ Avatar: () => null }));
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
		useTranslations:
			(ns?: string) =>
			(key: string, values: Record<string, unknown> = {}) =>
				String(lookup(ns, key) ?? key).replace(/\{(\w+)\}/g, (_, name) =>
					String(values[name]),
				),
	};
});

const field = (tree: { root: TestNode }, label: string) =>
	tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onChangeText === "function",
	)[0] as TestNode;

describe("Profile name undo", () => {
	it("shows the server's name and an error toast when the undo fails", async () => {
		mockUpdate.mockReset();
		mockToast.show.mockClear();
		mockUpdate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("no"));
		let tree!: { root: TestNode; unmount(): void };
		await act(async () => {
			tree = create(<ProfileSection />);
		});
		const name = () => field(tree, "Display name");
		act(() => (name().props.onChangeText as (t: string) => void)("Sofia R"));
		await act(async () => {
			(name().props.onBlur as () => void)();
		});
		const saved = mockToast.show.mock.calls[0]?.[0] as {
			undo: { onUndo: () => Promise<void> };
		};
		expect(saved.undo).toBeDefined();
		await act(async () => {
			await saved.undo.onUndo();
		});
		expect(mockUpdate).toHaveBeenCalledTimes(2);
		expect(name().props.value).toBe("Sofia R");
		expect(mockToast.show.mock.calls.at(-1)?.[0]).toEqual({
			message: "Couldn't save your profile. Try again.",
		});
		act(() => tree.unmount());
	});
});
