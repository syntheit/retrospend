import { PasswordSheet } from "./PasswordSheet";

// The password sheet: Update password waits for the current password, every
// rule and a matching confirmation; it sends both passwords once, closes and
// says the other devices are signed out; a refusal stays in the sheet in the
// words for its status.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockChange = jest.fn();
jest.mock("@/auth/session", () => ({
	useSession: () => ({ api: { account: { changePassword: mockChange } } }),
}));
jest.mock("@/data/ids", () => ({ newClientId: () => "key-1" }));
const mockToast = { show: jest.fn(), dismiss: jest.fn() };
jest.mock("@/ui/Toast", () => ({ useToast: () => mockToast }));
jest.mock("@/ui/Glyph", () => ({ Glyph: () => null }));
jest.mock("@/ui/Sheet", () => {
	const { View } = require("react-native");
	return {
		Sheet: ({ children, visible }: { children: unknown; visible: boolean }) =>
			visible ? <View>{children}</View> : null,
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
				testID={`field:${props.label}`}
				value={props.value}
			/>
		),
	};
});
jest.mock("@/ui/Button", () => {
	const { Pressable, Text } = require("react-native");
	return {
		Button: (props: { label: string; disabled?: boolean; onPress(): void }) => (
			<Pressable
				accessibilityState={{ disabled: !!props.disabled }}
				onPress={props.onPress}
				testID="submit"
			>
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

const onClose = jest.fn();

function render() {
	let root: { root: TestNode } | undefined;
	act(() => {
		root = create(<PasswordSheet onClose={onClose} visible />);
	});
	if (!root) throw new Error("not rendered");
	const tree = root.root;
	const byId = (id: string) =>
		tree.findAll((n) => n.props.testID === id)[0] as TestNode;
	const type = (label: string, text: string) =>
		act(() => {
			(byId(`field:${label}`).props.onChangeText as (v: string) => void)(text);
		});
	const submit = async () => {
		await act(async () => {
			await (byId("submit").props.onPress as () => Promise<void>)();
		});
	};
	const disabled = () =>
		(byId("submit").props.accessibilityState as { disabled: boolean }).disabled;
	const texts = () =>
		tree
			.findAll((n) => typeof n.props.children === "string")
			.map((n) => n.props.children as string);
	return { type, submit, disabled, texts };
}

beforeEach(() => {
	mockChange.mockReset();
	mockToast.show.mockReset();
	onClose.mockReset();
});

describe("PasswordSheet", () => {
	it("waits for every rule and a match, then changes the password once", async () => {
		mockChange.mockResolvedValue({ signedOut: 2 });
		const s = render();
		expect(s.disabled()).toBe(true);
		s.type("Current password", "Old password 1");
		s.type("New password", "Battery staple 2");
		expect(s.disabled()).toBe(true);
		s.type("Confirm new password", "Battery staple 2");
		expect(s.disabled()).toBe(false);
		await s.submit();
		expect(mockChange).toHaveBeenCalledTimes(1);
		expect(mockChange).toHaveBeenCalledWith(
			{ currentPassword: "Old password 1", newPassword: "Battery staple 2" },
			{ context: { idempotencyKey: "key-1" } },
		);
		expect(onClose).toHaveBeenCalled();
		expect(mockToast.show).toHaveBeenCalledWith({
			message: "Password changed. Your other devices are signed out.",
		});
	});

	it("keeps a refusal in the sheet in the words for its status", async () => {
		const s = render();
		s.type("Current password", "Wrong 1");
		s.type("New password", "Battery staple 2");
		s.type("Confirm new password", "Battery staple 2");
		mockChange.mockRejectedValueOnce({ status: 400 });
		await s.submit();
		expect(s.texts()).toContain("The current password is wrong.");
		mockChange.mockRejectedValueOnce({ status: 429 });
		await s.submit();
		expect(s.texts()).toContain("Too many tries. Try again later.");
		expect(onClose).not.toHaveBeenCalled();
	});

	it("says when the new passwords differ", () => {
		const s = render();
		s.type("New password", "Battery staple 2");
		s.type("Confirm new password", "Battery staple 3");
		expect(s.texts()).toContain("The new passwords don't match");
	});
});
