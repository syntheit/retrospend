import { createElement } from "react";
import SignInScreen from "../app/sign-in";

// A recorded account that the server now answers with no keys (a reset removed
// them) is refused. The sign-in error then offers "I reset my password": a
// native confirm, and only on confirm is the record forgotten and the sign-in
// retried. Other failures offer nothing.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockSignIn = jest.fn();
const mockForget = jest.fn();
const mockAlert = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({
		connection: { status: "connected", baseUrl: "https://retrospend.app" },
		disconnect: jest.fn(),
	}),
}));
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		state: { status: "signedOut" },
		signIn: (...args: unknown[]) => mockSignIn(...args),
		verifyCode: jest.fn(),
	}),
}));
jest.mock("@/auth/sign-in-secret", () => ({
	forgetKeyed: (...args: unknown[]) => mockForget(...args),
}));
jest.mock("@/ui/alert", () => ({
	showAlert: (...args: unknown[]) => mockAlert(...args),
}));
jest.mock("@/ui/Button", () => ({
	Button: (props: Record<string, unknown>) =>
		require("react").createElement("Button", props),
}));
jest.mock("@/ui/Screen", () => ({
	Screen: ({ children }: { children: unknown }) =>
		require("react").createElement("View", null, children),
}));

interface Node {
	props: Record<string, unknown>;
}
async function setup() {
	let tree!: { root: { findAllByType(type: unknown): Node[] } };
	act(() => {
		tree = create(createElement(SignInScreen));
	});
	const { TextInput } = require("react-native");
	const [email, password] = tree.root.findAllByType(TextInput);
	if (!email || !password) throw new Error("expected two fields");
	await act(async () => {
		(email.props.onChangeText as (v: string) => void)(" Ana@Example.com ");
		(password.props.onChangeText as (v: string) => void)("typed pw");
	});
	const labels = () =>
		tree.root.findAllByType("Button").map((b) => b.props.label);
	const press = async (label: string) => {
		const button = tree.root
			.findAllByType("Button")
			.find((b) => b.props.label === label);
		if (!button) throw new Error(`no button ${label}`);
		await act(async () => {
			await (button.props.onPress as () => Promise<void>)();
		});
	};
	return { labels, press };
}

beforeEach(() => {
	for (const m of [mockSignIn, mockForget, mockAlert]) m.mockReset();
	mockForget.mockResolvedValue(undefined);
});

describe("sign-in after a reset removed the keys", () => {
	it("offers the action only for a definite keysMissing refusal", async () => {
		const s = await setup();
		expect(s.labels()).not.toContain("resetAction");
		for (const reason of [
			"network",
			"protectionRefused",
			"invalidCredentials",
		]) {
			mockSignIn.mockResolvedValueOnce({ status: "error", reason });
			await s.press("submit");
			expect(s.labels()).not.toContain("resetAction");
		}
		mockSignIn.mockResolvedValueOnce({
			status: "error",
			reason: "keysMissing",
		});
		await s.press("submit");
		expect(s.labels()).toContain("resetAction");
	});

	it("changes nothing on cancel", async () => {
		const s = await setup();
		mockSignIn.mockResolvedValueOnce({
			status: "error",
			reason: "keysMissing",
		});
		await s.press("submit");
		await s.press("resetAction");
		expect(mockAlert).toHaveBeenCalledTimes(1);
		const [title, , buttons] = mockAlert.mock.calls[0] as [
			string,
			unknown,
			{ text: string; style?: string; onPress?: () => void }[],
		];
		expect(title).toBe("resetConfirm");
		expect(buttons.find((b) => b.style === "cancel")?.onPress).toBeUndefined();
		expect(mockForget).not.toHaveBeenCalled();
		expect(mockSignIn).toHaveBeenCalledTimes(1);
	});

	it("forgets the record on confirm and signs in again with the typed password", async () => {
		const s = await setup();
		mockSignIn.mockResolvedValueOnce({
			status: "error",
			reason: "keysMissing",
		});
		await s.press("submit");
		await s.press("resetAction");
		const buttons = mockAlert.mock.calls[0]?.[2] as {
			text: string;
			onPress?: () => void;
		}[];
		mockSignIn.mockResolvedValueOnce({ status: "signedIn" });
		await act(async () => {
			buttons.find((b) => b.text === "submit")?.onPress?.();
		});
		expect(mockForget).toHaveBeenCalledWith(
			"https://retrospend.app",
			"Ana@Example.com",
		);
		expect(mockSignIn).toHaveBeenCalledTimes(2);
		expect(mockSignIn).toHaveBeenLastCalledWith("Ana@Example.com", "typed pw");
		// The record is gone before the retry.
		expect(mockForget.mock.invocationCallOrder[0]).toBeLessThan(
			mockSignIn.mock.invocationCallOrder[1] ?? 0,
		);
	});
});
