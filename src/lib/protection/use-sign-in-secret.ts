"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { authClient } from "~/lib/auth-client";
import {
	accountIsKeyed,
	SignInSecretError,
	signInSecretFor,
} from "./sign-in-secret";

/** Whether a rejection of the hooks below is the refusal of a keyed address answered with no keys. */
export const isDowngradeRefusal = (e: unknown): boolean =>
	e instanceof Error &&
	e.cause instanceof SignInSecretError &&
	e.cause.code === "downgrade";

/** The sign-in form words a refusal as a sign-in; the prompts inside the app say what they could not check. */
function useMessage(
	namespace: "signInSecret" | "passwordCheck" = "passwordCheck",
) {
	const t = useTranslations(`settingsV2.${namespace}`);
	return useCallback(
		(error: unknown): Error =>
			// The cause lets a caller offer a way out of a refusal (the sign-in form).
			new Error(
				error instanceof SignInSecretError ? t(error.code) : t("unavailable"),
				{ cause: error },
			),
		[t],
	);
}

/**
 * For the sign-in form: the text to send as the password for a typed address.
 * Rejects with an Error whose message is ready to show.
 */
export function useSignInSecret() {
	const message = useMessage("signInSecret");
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

/**
 * For the password change: whether the signed-in account has keys, so the
 * sheet can say so without sending the typed password. Rejects with an Error
 * whose message is ready to show.
 */
export function useAccountIsKeyed() {
	const message = useMessage();
	const { data: session } = authClient.useSession();
	const email = session?.user.email;
	return useCallback(
		() =>
			(email
				? accountIsKeyed(email)
				: Promise.reject(new SignInSecretError("unavailable"))
			).catch((e: unknown) => {
				throw message(e);
			}),
		[email, message],
	);
}
