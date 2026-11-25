import { KeyFlowError } from "@retrospend/crypto/client";
import {
	act,
	disabled,
	mount,
	pressAsync,
	type TestNode,
	type Tree,
	type as typeInto,
	words,
	world,
} from "../../../test/harness";
import { ForgotPasswordScreen } from "./ForgotPasswordScreen";

// Forgot password on the phone: the email, the code, then the choices. What
// matters here: the screen says the same thing for every address, a code that
// cannot be a code spends no try, the plain reset is the web's page and only
// when protection is off, and the recovery sheet gets the token's callbacks.
jest.mock("@retrospend/api-contract", () =>
	jest.requireActual(
		"../../../../../packages/api-contract/src/account/password-rules",
	),
);
jest.mock("@/ui/Button", () => require("../../../test/native").buttonMock);
jest.mock("@/ui/Screen", () => ({
	Screen: ({ children }: { children: unknown }) => children,
}));
const mockRouter = {
	back: jest.fn(),
	replace: jest.fn(),
	canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({
		connection: { status: "connected", baseUrl: "https://example.test" },
	}),
}));
jest.mock("@/auth/public-api", () => ({ publicAuthApi: () => ({}) }));
const mockAsk = {
	requestResetCode: jest.fn(),
	redeemResetCode: jest.fn(),
	checkRecoveryLink: jest.fn(),
	phoneRecoveryCallbacks: jest.fn(),
};
// Looked up at call time: the imports above run before the consts below exist.
jest.mock("@/auth/recovery", () => ({
	requestResetCode: (...a: unknown[]) => mockAsk.requestResetCode(...a),
	redeemResetCode: (...a: unknown[]) => mockAsk.redeemResetCode(...a),
	checkRecoveryLink: (...a: unknown[]) => mockAsk.checkRecoveryLink(...a),
	phoneRecoveryCallbacks: (...a: unknown[]) =>
		mockAsk.phoneRecoveryCallbacks(...a),
}));
const mockOpenWeb = jest.fn();
jest.mock("@/features/settings/webPages", () => ({
	openWebPage: (...a: unknown[]) => mockOpenWeb(...a),
}));
const mockSheet = jest.fn();
jest.mock("./RecoverSheet", () => ({
	RecoverSheet: (props: Record<string, unknown>) => {
		mockSheet(props);
		return null;
	},
}));

const callbacks = { begin: jest.fn(), finish: jest.fn() };
const lastSheet = () =>
	mockSheet.mock.calls.at(-1)?.[0] as {
		visible: boolean;
		begin: unknown;
		finish: unknown;
		onClose: () => void;
		onDone: (r: "set" | "linkSpent") => void;
	};

const field = (tree: Tree, label: string): TestNode | undefined =>
	tree.root.findAll(
		(n) =>
			n.props.accessibilityLabel === label &&
			typeof n.props.onChangeText === "function",
	)[0];
const present = (tree: Tree, label: string) =>
	tree.root.findAll((n) => n.props.accessibilityLabel === label).length > 0;

const show = (email = "ana@example.com") =>
	mount(<ForgotPasswordScreen initialEmail={email} />);
async function toCode(tree: Tree) {
	await pressAsync(tree, "Send code");
}
async function toChoices(tree: Tree, protectionOn: boolean) {
	mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "token-1" });
	mockAsk.checkRecoveryLink.mockResolvedValue({
		keys: "recovery",
		protectionOn,
	});
	await toCode(tree);
	typeInto(tree, "Code", "7K2M-9PQ4");
	await pressAsync(tree, "Continue");
}

beforeEach(() => {
	for (const fn of [
		...Object.values(mockAsk),
		mockOpenWeb,
		mockSheet,
		mockRouter.back,
		mockRouter.replace,
	])
		fn.mockReset();
	mockRouter.canGoBack.mockReturnValue(true);
	mockAsk.requestResetCode.mockResolvedValue({ ok: true, value: null });
	mockAsk.phoneRecoveryCallbacks.mockReturnValue(callbacks);
});

describe("Forgot password, the email", () => {
	it("starts with the email typed on the sign-in screen, and sends only a typed address", async () => {
		const tree = await show("ana@example.com");
		expect(field(tree, "Email")?.props.value).toBe("ana@example.com");
		typeInto(tree, "Email", "no at sign");
		expect(disabled(tree, "Send code")).toBe(true);
		typeInto(tree, "Email", "ana@example.com");
		await pressAsync(tree, "Send code");
		expect(mockAsk.requestResetCode).toHaveBeenCalledWith(
			expect.anything(),
			"ana@example.com",
		);
	});

	it("goes to the code the same way for every address, without saying whether one exists", async () => {
		const tree = await show();
		await toCode(tree);
		expect(words(tree)).toContain(
			"If this email can use a recovery key, we sent it a code.",
		);
		expect(present(tree, "Send code")).toBe(false);
	});

	it.each([
		["tooMany", "Too many tries. Try again later."],
		["cannotSend", "This server can't send email."],
		["network", "Couldn't reach the server. Check your connection."],
		["failed", "Couldn't finish. Try again."],
	] as const)("stays on the email with the words for %s", async (reason, text) => {
		mockAsk.requestResetCode.mockResolvedValue({ ok: false, reason });
		const tree = await show();
		await toCode(tree);
		expect(words(tree)).toContain(text);
		expect(present(tree, "Send code")).toBe(true);
	});
});

describe("Forgot password, the code", () => {
	it("swaps what is typed and goes on only with a link that leads to recovery", async () => {
		const tree = await show();
		await toChoices(tree, true);
		expect(mockAsk.redeemResetCode).toHaveBeenCalledWith(
			expect.anything(),
			"ana@example.com",
			"7K2M-9PQ4",
		);
		expect(mockAsk.checkRecoveryLink).toHaveBeenCalledWith(
			expect.anything(),
			"token-1",
		);
		expect(mockAsk.phoneRecoveryCallbacks).toHaveBeenCalledWith(
			expect.anything(),
			"token-1",
		);
	});

	it("refuses a code that cannot be one before asking the server", async () => {
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("Check the code for a typo.");
		expect(mockAsk.redeemResetCode).not.toHaveBeenCalled();
	});

	it("says a wrong code and keeps the code step", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: false, reason: "wrongCode" });
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("That code didn't work.");
		expect(mockAsk.checkRecoveryLink).not.toHaveBeenCalled();
		// Typing again clears the line.
		typeInto(tree, "Code", "7K2M9PQ5");
		expect(words(tree)).not.toContain("That code didn't work.");
	});

	it("says expired for a token the check does not know, and never opens the choices", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "t" });
		mockAsk.checkRecoveryLink.mockResolvedValue("invalid");
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("That code has expired. Ask for a new one.");
		expect(mockAsk.phoneRecoveryCallbacks).not.toHaveBeenCalled();
	});

	it("never reads a check that could not be answered as the plain reset", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "t" });
		mockAsk.checkRecoveryLink.mockRejectedValue(new KeyFlowError("unavailable"));
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain(
			"Couldn't reach the server. Check your connection.",
		);
		expect(words(tree)).not.toContain("Reset password");
	});

	it("goes Back to the email", async () => {
		const tree = await show();
		await toCode(tree);
		await pressAsync(tree, "Back");
		expect(present(tree, "Send code")).toBe(true);
	});
});

describe("Forgot password, a check that failed after the swap", () => {
	it("keeps the token and asks only the check again, never the spent code", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "token-1" });
		mockAsk.checkRecoveryLink
			.mockRejectedValueOnce(new KeyFlowError("unavailable"))
			.mockResolvedValue({ keys: "recovery", protectionOn: true });
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain(
			"Couldn't reach the server. Check your connection.",
		);
		// Continue stays on, whatever the code field says now.
		expect(disabled(tree, "Continue")).toBe(false);
		await pressAsync(tree, "Continue");
		expect(mockAsk.redeemResetCode).toHaveBeenCalledTimes(1);
		expect(mockAsk.checkRecoveryLink).toHaveBeenCalledTimes(2);
		expect(mockAsk.checkRecoveryLink).toHaveBeenLastCalledWith(
			expect.anything(),
			"token-1",
		);
		expect(words(tree)).toContain("Open your protected data");
	});

	it("a changed code is a new attempt: the kept token is dropped and the edit is swapped", async () => {
		mockAsk.redeemResetCode
			.mockResolvedValueOnce({ ok: true, value: "token-1" })
			.mockResolvedValueOnce({ ok: true, value: "token-2" });
		mockAsk.checkRecoveryLink
			.mockRejectedValueOnce(new KeyFlowError("unavailable"))
			.mockResolvedValue({ keys: "recovery", protectionOn: true });
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		typeInto(tree, "Code", "7K2M9PQ5");
		await pressAsync(tree, "Continue");
		expect(mockAsk.redeemResetCode).toHaveBeenCalledTimes(2);
		expect(mockAsk.redeemResetCode).toHaveBeenLastCalledWith(
			expect.anything(),
			"ana@example.com",
			"7K2M9PQ5",
		);
		expect(mockAsk.checkRecoveryLink).toHaveBeenLastCalledWith(
			expect.anything(),
			"token-2",
		);
	});

	it("asks for a new code once the server no longer knows the token", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "token-1" });
		mockAsk.checkRecoveryLink
			.mockRejectedValueOnce(new KeyFlowError("unavailable"))
			.mockResolvedValueOnce("invalid")
			.mockResolvedValue({ keys: "recovery", protectionOn: true });
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("That code has expired. Ask for a new one.");
		// The token is gone: the next Continue swaps a typed code again.
		typeInto(tree, "Code", "7K2M9PQ5");
		await pressAsync(tree, "Continue");
		expect(mockAsk.redeemResetCode).toHaveBeenCalledTimes(2);
	});

	it("going Back to the email forgets the token", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "token-1" });
		mockAsk.checkRecoveryLink.mockRejectedValue(new KeyFlowError("unavailable"));
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		await pressAsync(tree, "Back");
		await toCode(tree);
		expect(disabled(tree, "Continue")).toBe(true);
	});
});

describe("Forgot password, the code field", () => {
	it("is read as a one-time code that is typed in capitals", async () => {
		const tree = await show();
		await toCode(tree);
		const code = field(tree, "Code");
		expect(code?.props.textContentType).toBe("oneTimeCode");
		expect(code?.props.autoComplete).toBe("one-time-code");
		expect(code?.props.autoCapitalize).toBe("characters");
	});
});

describe("Forgot password, the choices", () => {
	it("with protection on: the key leads, another device says why not, and Reset account is disabled", async () => {
		const tree = await show();
		await toChoices(tree, true);
		expect(words(tree)).toContain("Open your protected data");
		expect(words(tree)).toContain(
			"Your password cannot be reset by email. Use one of these.",
		);
		expect(words(tree)).toContain("Another device");
		expect(words(tree)).toContain("Not available yet");
		const reset = tree.root.findAll(
			(n) =>
				n.props.accessibilityRole === "button" &&
				(n.props.accessibilityState as { disabled?: boolean } | undefined)
					?.disabled === true &&
				words({ root: n } as Tree).includes("Reset account"),
		);
		expect(reset.length).toBeGreaterThan(0);
		expect(words(tree)).not.toContain("Reset password");
		expect(mockOpenWeb).not.toHaveBeenCalled();
	});

	it("with protection off: Reset password is the web's page, which removes the keys", async () => {
		const tree = await show();
		await toChoices(tree, false);
		expect(words(tree)).toContain("Reset your password");
		expect(words(tree)).toContain("Removes your keys and recovery key.");
		const reset = tree.root.findAll(
			(n) =>
				n.props.accessibilityRole === "link" &&
				typeof n.props.onPress === "function",
		)[0];
		expect(reset).toBeDefined();
		if (!reset) throw new Error("no Reset password link");
		act(() => (reset.props.onPress as () => void)());
		expect(mockOpenWeb).toHaveBeenCalledWith(
			"https://example.test",
			"/auth/forgot-password",
		);
	});

	it("Use key opens the recovery sheet with the token's callbacks", async () => {
		const tree = await show();
		await toChoices(tree, true);
		expect(lastSheet().visible).toBe(false);
		await pressAsync(tree, "Use key");
		expect(lastSheet().visible).toBe(true);
		expect(lastSheet().begin).toBe(callbacks.begin);
		expect(lastSheet().finish).toBe(callbacks.finish);
	});

	it("a link that leads to no recovery key keeps Use key, disabled, with its reason and no sheet", async () => {
		mockAsk.redeemResetCode.mockResolvedValue({ ok: true, value: "t" });
		mockAsk.checkRecoveryLink.mockResolvedValue({
			keys: "noRecovery",
			protectionOn: true,
		});
		const tree = await show();
		await toCode(tree);
		typeInto(tree, "Code", "7K2M9PQ4");
		await pressAsync(tree, "Continue");
		expect(words(tree)).toContain("This account has no recovery key.");
		expect(disabled(tree, "Use key")).toBe(true);
		expect(lastSheet().visible).toBe(false);
	});

	it("a new password goes back to sign-in with the words that say to use it", async () => {
		const tree = await show();
		await toChoices(tree, true);
		act(() => lastSheet().onDone("set"));
		expect(world.toast.show).toHaveBeenCalledWith({
			message: "Sign in with your new password.",
		});
		expect(mockRouter.back).toHaveBeenCalledTimes(1);
	});

	it("a spent link says the same, and a screen with nothing to go back to opens sign-in", async () => {
		mockRouter.canGoBack.mockReturnValue(false);
		const tree = await show();
		await toChoices(tree, true);
		act(() => lastSheet().onDone("linkSpent"));
		expect(world.toast.show).toHaveBeenCalledWith({
			message: "Sign in with your new password.",
		});
		expect(mockRouter.replace).toHaveBeenCalledWith("/sign-in");
	});
});
