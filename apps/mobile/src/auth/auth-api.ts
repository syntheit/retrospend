// Sign-in against the server's better-auth routes (/api/auth/*) through
// @better-auth/expo. The Expo client sends the app's origin, so the server
// stamps the session as the mobile app's (scoped, no admin) and hands the
// session token back in `set-auth-token`. That token is the bearer for API
// v1; the Expo client keeps its own cookie only for the 2FA step, which the
// server ties to a cookie set by the password step.
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
import { type AuthFailure, authFailureOf } from "./errors";
import type { TokenStore } from "./token-store";

export type SignInStep =
	| { status: "signedIn" }
	| { status: "twoFactor" }
	| { status: "error"; reason: AuthFailure };

export interface AuthApi {
	signIn(email: string, password: string): Promise<SignInStep>;
	/** The 6-digit authenticator code, or a backup code. */
	verifyCode(code: string): Promise<SignInStep>;
	signOut(): Promise<void>;
}

export function createAuthApi(baseUrl: string, tokens: TokenStore): AuthApi {
	const client = createAuthClient({
		baseURL: baseUrl,
		plugins: [
			expoClient({
				scheme: "retrospend",
				storagePrefix: "retrospend",
				storage: SecureStore,
			}),
			twoFactorClient(),
		],
		fetchOptions: {
			auth: { type: "Bearer", token: () => tokens.get().then((t) => t ?? "") },
			onSuccess: async (context) => {
				const token = context.response.headers.get("set-auth-token");
				if (token) await tokens.set(token);
			},
		},
	});

	async function step(
		run: () => Promise<{
			data: unknown;
			error: { status?: number; code?: string } | null;
		}>,
	): Promise<SignInStep> {
		try {
			const { data, error } = await run();
			if (error) return { status: "error", reason: authFailureOf(error) };
			if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
				return { status: "twoFactor" };
			}
			return (await tokens.get())
				? { status: "signedIn" }
				: { status: "error", reason: "unknown" };
		} catch {
			return { status: "error", reason: "network" };
		}
	}

	return {
		signIn: (email, password) =>
			step(() => client.signIn.email({ email, password })),
		verifyCode: (code) => {
			const clean = code.replace(/\s/g, "");
			// A backup code is longer than the 6 digits an authenticator shows.
			return step(() =>
				clean.length > 6
					? client.twoFactor.verifyBackupCode({ code: clean })
					: client.twoFactor.verifyTotp({ code: clean }),
			);
		},
		async signOut() {
			try {
				await client.signOut();
			} catch {
				// Offline sign out still forgets the token on this phone.
			}
		},
	};
}
