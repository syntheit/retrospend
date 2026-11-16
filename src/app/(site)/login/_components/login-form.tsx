"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import {
	forgetKeyed,
	SignInSecretError,
} from "~/lib/protection/sign-in-secret";
import { useSignInSecret } from "~/lib/protection/use-sign-in-secret";
import { safeRedirect } from "~/lib/safe-redirect";
import { api } from "~/trpc/react";
import { AuthenticatorStep, BackupCodeStep } from "./login-two-factor";

function LoginFormInner() {
	const t = useTranslations("auth");
	const ts = useTranslations("settingsV2.signInSecret");
	const searchParams = useSearchParams();
	// `redirect` comes from in-app links, `callbackUrl` from the proxy when a
	// signed-out visitor opens a protected page (the device page keeps its
	// user_code this way). Both are same-site paths only.
	const redirectTo = safeRedirect(
		searchParams.get("redirect") ?? searchParams.get("callbackUrl"),
	);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	const [show2FA, setShow2FA] = useState(false);
	const [totpCode, setTotpCode] = useState("");
	// Second step with a saved backup code instead of the authenticator app
	const [useBackupCode, setUseBackupCode] = useState(false);
	const [backupCode, setBackupCode] = useState("");

	const signInSecret = useSignInSecret();
	// Set when this browser remembers the address as keyed and the server now
	// says it is not: the person may have reset the password since.
	const [staleKeys, setStaleKeys] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
	const { data: appFeatures } = api.auth.getAppFeatures.useQuery();

	const signIn = async () => {
		setIsLoading(true);
		setError("");
		setStaleKeys(false);

		try {
			const address = email.trim().toLowerCase();
			let secret: string;
			try {
				// Keyed accounts sign in with a key made from the password here
				// (about a second), never with the password itself.
				secret = await signInSecret(address, password);
			} catch (e) {
				setError(e instanceof Error ? e.message : t("unexpectedError"));
				setStaleKeys(
					e instanceof Error &&
						e.cause instanceof SignInSecretError &&
						e.cause.code === "downgrade",
				);
				return;
			}
			const result = await authClient.signIn.email({
				email: address,
				password: secret,
			});

			if (result.error) {
				// Check if 2FA is required
				if (
					result.error.message?.toLowerCase().includes("two factor") ||
					result.error.message?.toLowerCase().includes("2fa") ||
					(result.error.status === 403 &&
						result.error.message?.toLowerCase().includes("two"))
				) {
					setShow2FA(true);
					setError("");
				} else {
					setError(result.error.message || t("loginFailed"));
				}
			} else {
				// Some versions of better-auth return it in data
				if (
					(result.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect
				) {
					setShow2FA(true);
					setError("");
				} else {
					window.location.href = redirectTo;
				}
			}
		} catch (_) {
			setError(t("unexpectedError"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		void signIn();
	};

	const signInWithNewPassword = async () => {
		await forgetKeyed(email);
		setConfirmReset(false);
		await signIn();
	};

	const handleVerify2FA = async (
		e?: React.FormEvent,
		codeToVerify?: string,
	) => {
		if (e) e.preventDefault();
		if (isLoading) return;

		const code = codeToVerify || totpCode;
		if (code.length !== 6) return;

		setIsLoading(true);
		setError("");

		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: code,
			});

			if (result.error) {
				setError(result.error.message || t("invalidAuthenticatorCode"));
			} else {
				window.location.href = redirectTo;
			}
		} catch (_) {
			setError(t("unexpectedErrorVerification"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleVerifyBackupCode = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isLoading) return;

		const code = backupCode.trim();
		if (!code) return;

		setIsLoading(true);
		setError("");

		try {
			const result = await authClient.twoFactor.verifyBackupCode({ code });

			if (result.error) {
				setError(result.error.message || t("invalidBackupCode"));
			} else {
				window.location.href = redirectTo;
			}
		} catch (_) {
			setError(t("unexpectedErrorVerification"));
		} finally {
			setIsLoading(false);
		}
	};

	const switch2FAMethod = (backup: boolean) => {
		setUseBackupCode(backup);
		setTotpCode("");
		setBackupCode("");
		setError("");
	};

	if (show2FA && useBackupCode) {
		return (
			<BackupCodeStep
				backupCode={backupCode}
				error={error}
				isLoading={isLoading}
				onBack={() => {
					switch2FAMethod(false);
					setShow2FA(false);
				}}
				onSubmit={handleVerifyBackupCode}
				onUseAuthenticator={() => switch2FAMethod(false)}
				setBackupCode={setBackupCode}
			/>
		);
	}

	if (show2FA) {
		return (
			<AuthenticatorStep
				error={error}
				isLoading={isLoading}
				onBack={() => {
					setShow2FA(false);
					setTotpCode("");
				}}
				onComplete={(code) => handleVerify2FA(undefined, code)}
				onSubmit={handleVerify2FA}
				onUseBackupCode={() => switch2FAMethod(true)}
				setTotpCode={setTotpCode}
				totpCode={totpCode}
			/>
		);
	}
	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				description={t("signInDescription")}
				title={t("welcomeToRetrospend")}
			>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor="email">{t("email")}</Label>
						<Input
							disabled={isLoading}
							id="email"
							onChange={(e) => setEmail(e.target.value)}
							placeholder={t("enterYourEmail")}
							required
							type="email"
							value={email}
						/>
					</div>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="password">{t("password")}</Label>
							{appFeatures?.isEmailEnabled && (
								<Link
									className="text-primary text-sm font-medium hover:underline"
									href="/auth/forgot-password"
									tabIndex={-1}
								>
									{t("forgotYourPassword")}
								</Link>
							)}
						</div>
						<Input
							disabled={isLoading}
							id="password"
							onChange={(e) => setPassword(e.target.value)}
							placeholder={t("enterYourPassword")}
							required
							type="password"
							value={password}
						/>
					</div>
					{error && <div className="text-destructive text-sm">{error}</div>}
					{staleKeys && (
						<Button
							className="text-muted-foreground h-auto p-0 hover:underline"
							onClick={() => setConfirmReset(true)}
							type="button"
							variant="link"
						>
							{ts("resetAction")}
						</Button>
					)}
					<Button className="w-full" disabled={isLoading} type="submit">
						{isLoading ? t("signingIn") : t("signIn")}
					</Button>
				</form>
				<ConfirmationDialog
					confirmLabel={t("signIn")}
					description={ts("resetBody")}
					isLoading={isLoading}
					onConfirm={() => void signInWithNewPassword()}
					onOpenChange={setConfirmReset}
					open={confirmReset}
					title={ts("resetTitle")}
				/>
				<div className="mt-4 text-center">
					<p className="text-muted-foreground text-sm">
						{t("dontHaveAccount")}{" "}
						<Link
							className="text-primary font-medium hover:underline"
							href={
								redirectTo === "/home"
									? "/signup"
									: `/signup?redirect=${encodeURIComponent(redirectTo)}`
							}
						>
							{t("signUp")}
						</Link>
					</p>
				</div>
			</AuthPanel>
		</div>
	);
}

export function LoginForm() {
	return (
		<Suspense
			fallback={
				<div className="bg-background flex min-h-screen items-center justify-center px-4">
					<div className="flex w-full max-w-md items-center justify-center p-12">
						<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
					</div>
				</div>
			}
		>
			<LoginFormInner />
		</Suspense>
	);
}
