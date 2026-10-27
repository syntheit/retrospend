import { createElement } from "react";
import SignInScreen from "../app/sign-in";

// Password managers (Bitwarden on Android, Password AutoFill on iOS) find the
// sign-in fields by their hints. Android needs the "username" hint on the
// email field (the "email" value maps to emailAddress, which managers do not
// treat as the login name) and iOS needs textContentType.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

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
		connection: { status: "connected", baseUrl: "https://retrospend.app" },
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
jest.mock("@/ui/Button", () => ({ Button: () => null }));
jest.mock("@/ui/Screen", () => ({
	Screen: ({ children }: { children: unknown }) =>
		require("react").createElement("View", null, children),
}));

function fields() {
	let tree!: {
		root: {
			findAllByType(type: unknown): { props: Record<string, unknown> }[];
		};
	};
	act(() => {
		tree = create(createElement(SignInScreen));
	});
	const { TextInput } = require("react-native");
	const [email, password] = tree.root.findAllByType(TextInput);
	if (!email || !password) throw new Error("expected two fields");
	return { email: email.props, password: password.props };
}

describe("sign-in autofill hints", () => {
	it("marks the email field as the username and the other as the password", () => {
		const { email, password } = fields();
		expect(email.autoComplete).toBe("username");
		expect(email.textContentType).toBe("username");
		expect(email.importantForAutofill).toBe("yes");
		expect(password.autoComplete).toBe("current-password");
		expect(password.textContentType).toBe("password");
		expect(password.secureTextEntry).toBe(true);
		expect(password.importantForAutofill).toBe("yes");
	});
});
