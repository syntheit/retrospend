import { createElement } from "react";
import SignInScreen from "../app/sign-in";

// The app has no sign-up form of its own: a new person creates the account on
// the connected server's own page, opened in the system browser sheet (an
// SFSafariViewController on iOS, a Custom Tab on Android).
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockOpen = jest.fn();
const mockServer = { current: "https://money.example.com/app" };
jest.mock("expo-web-browser", () => ({
	openBrowserAsync: (url: string) => mockOpen(url),
}));
jest.mock("expo-router", () => ({
	Stack: { Screen: () => null },
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({
		connection: { status: "connected", baseUrl: mockServer.current },
		disconnect: jest.fn(),
	}),
}));
jest.mock("@/auth/session", () => ({
	useSession: () => ({
		state: { status: "signedOut" },
		signIn: jest.fn(),
		verifyCode: jest.fn(),
	}),
}));
jest.mock("@/ui/Button", () => ({
	Button: (props: Record<string, unknown>) =>
		require("react").createElement("Button", props),
}));
jest.mock("@/ui/Screen", () => ({
	Screen: ({ children }: { children: unknown }) =>
		require("react").createElement("View", null, children),
}));

function buttons() {
	let tree!: {
		root: {
			findAllByType(type: string): { props: Record<string, unknown> }[];
		};
	};
	act(() => {
		tree = create(createElement(SignInScreen));
	});
	return tree.root.findAllByType("Button").map((b) => b.props);
}

describe("sign-in create an account", () => {
	it("opens the connected server's sign-up page in the system browser", () => {
		mockOpen.mockClear();
		const link = buttons().find((b) => b.label === "createAccount");
		if (!link) throw new Error("no Create an account button");
		(link.onPress as () => void)();
		expect(mockOpen).toHaveBeenCalledWith(
			"https://money.example.com/app/signup",
		);
	});

	it("sits between Sign in and Change server", () => {
		expect(buttons().map((b) => b.label)).toEqual([
			"submit",
			"createAccount",
			"changeServer",
		]);
	});
});
