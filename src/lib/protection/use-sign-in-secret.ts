"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { authClient } from "~/lib/auth-client";
import { SignInSecretError, signInSecretFor } from "./sign-in-secret";

function useMessage() {
	const t = useTranslations("settingsV2.signInSecret");
	return useCallback(
		(error: unknown): Error =>
			new Error(
				error instanceof SignInSecretError ? t(error.code) : t("unavailable"),
			),
		[t],
	);
}

/**
 * For the sign-in form: the text to send as the password for a typed address.
 * Rejects with an Error whose message is ready to show.
 */
export function useSignInSecret() {
	const message = useMessage();
	return useCallback(
		(email: string, password: string) =>
			signInSecretFor(email, password).catch((e: unknown) => {
				throw message(e);
			}),
		[message],
	);
}

/**
 * For prompts inside the app (two-factor, email change, account deletion):
 * the same, for the signed-in address, with the parameters read from the keys
 * route. Rejects with an Error whose message is ready to show.
 */
export function useSessionSignInSecret() {
	const message = useMessage();
	const { data: session } = authClient.useSession();
	const email = session?.user.email;
	return useCallback(
		(password: string) =>
			(email
				? signInSecretFor(email, password, { signedIn: true })
				: Promise.reject(new SignInSecretError("unavailable"))
			).catch((e: unknown) => {
				throw message(e);
			}),
		[email, message],
	);
}
