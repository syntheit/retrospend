// Sign-in sends what the helper resolves, and never the typed password when
// the helper refuses.
const mockSignIn = jest.fn();
jest.mock("@retrospend/api-contract", () => ({
	TWO_FACTOR_CODE_LENGTH: require("../../test/twoFactorCodeLength")
		.contractCodeLength,
}));
jest.mock("better-auth/client", () => ({
	createAuthClient: () => ({
		signIn: { email: mockSignIn },
		twoFactor: {},
		signOut: jest.fn(),
	}),
}));
jest.mock("better-auth/client/plugins", () => ({
	twoFactorClient: () => ({}),
}));
jest.mock("@better-auth/expo/client", () => ({ expoClient: () => ({}) }));
jest.mock("@/lib/secure-store", () => ({ secureStore: {} }));
jest.mock("./prelogin-lookup", () => ({ preloginLookup: () => "lookup" }));
jest.mock("./sign-in-secret", () => ({ resolveSignInSecret: jest.fn() }));

import { createAuthApi } from "./auth-api";
import type { TokenStore } from "./token-store";

const tokens: TokenStore = {
	get: async () => "token",
	set: async () => undefined,
	clear: async () => undefined,
};

beforeEach(() => mockSignIn.mockReset());

describe("createAuthApi signIn", () => {
	it("sends the resolved secret instead of the typed password", async () => {
		const resolve = jest.fn(async () => ({
			ok: true as const,
			secret: "SECRET",
		}));
		mockSignIn.mockResolvedValue({ data: {}, error: null });
		const api = createAuthApi("https://retrospend.app", tokens, resolve);
		expect(await api.signIn("a@b.co", "typed")).toEqual({ status: "signedIn" });
		expect(resolve).toHaveBeenCalledWith({
			baseUrl: "https://retrospend.app",
			email: "a@b.co",
			password: "typed",
			lookup: "lookup",
		});
		expect(mockSignIn).toHaveBeenCalledWith({
			email: "a@b.co",
			password: "SECRET",
		});
	});

	it("stops with the reason and sends nothing when the helper refuses", async () => {
		const resolve = jest.fn(async () => ({
			ok: false as const,
			reason: "protectionRefused" as const,
		}));
		const api = createAuthApi("https://retrospend.app", tokens, resolve);
		expect(await api.signIn("a@b.co", "typed")).toEqual({
			status: "error",
			reason: "protectionRefused",
		});
		expect(mockSignIn).not.toHaveBeenCalled();
	});
});
