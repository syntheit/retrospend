"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { api } from "~/trpc/react";

export function LoginForm() {
	const t = useTranslations("auth");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	const [show2FA, setShow2FA] = useState(false);
	const [totpCode, setTotpCode] = useState("");

	const { data: appFeatures } = api.auth.getAppFeatures.useQuery();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		try {
			const result = await authClient.signIn.email({
				email: email.trim().toLowerCase(),
				password,
			});

			if (result.error) {
				// Check if 2FA is required
				if (
					result.error.message?.toLowerCase().includes("two factor") ||
					result.error.message?.toLowerCase().includes("2fa") ||
					(result.error.status === 403 && result.error.message?.toLowerCase().includes("two"))
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
					window.location.href = "/dashboard";
				}
			}
		} catch (_) {
			setError(t("unexpectedError"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleVerify2FA = async (e?: React.FormEvent, codeToVerify?: string) => {
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
				window.location.href = "/dashboard";
			}
		} catch (_) {
			setError(t("unexpectedErrorVerification"));
		} finally {
			setIsLoading(false);
		}
	};

	if (show2FA) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-4">
				<Card className="w-full max-w-md">
					<CardHeader className="space-y-1">
						<CardTitle className="text-center font-bold text-2xl">
							{t("twoFactorAuth")}
						</CardTitle>
						<CardDescription className="text-center">
							{t("twoFactorDescription")}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="flex flex-col items-center space-y-6"
							onSubmit={handleVerify2FA}
						>
							<div className="space-y-2">
								<InputOTP 
									maxLength={6} 
									onChange={setTotpCode} 
									value={totpCode}
									onComplete={(code) => handleVerify2FA(undefined, code)}
								>
									<InputOTPGroup>
										<InputOTPSlot index={0} />
										<InputOTPSlot index={1} />
										<InputOTPSlot index={2} />
										<InputOTPSlot index={3} />
										<InputOTPSlot index={4} />
										<InputOTPSlot index={5} />
									</InputOTPGroup>
								</InputOTP>
							</div>

							{error && (
								<div className="text-destructive text-sm">
									{error}
								</div>
							)}

							<Button
								className="w-full"
								disabled={isLoading || totpCode.length !== 6}
								type="submit"
							>
								{isLoading ? t("verifying") : t("verifyCode")}
							</Button>

							<div className="mt-4 text-center text-sm">
								<Button
									className="h-auto p-0 text-muted-foreground hover:underline"
									onClick={() => {
										setShow2FA(false);
										setTotpCode("");
									}}
									type="button"
									variant="link"
								>
									{t("backToLogin")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						{t("welcomeToRetrospend")}
					</CardTitle>
					<CardDescription className="text-center">
						{t("signInDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
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
										className="font-medium text-primary text-sm hover:underline"
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
						{error && (
							<div className="text-destructive text-sm">
								{error}
							</div>
						)}
						<Button className="w-full" disabled={isLoading} type="submit">
							{isLoading ? t("signingIn") : t("signIn")}
						</Button>
					</form>
					<div className="mt-4 text-center">
						<p className="text-muted-foreground text-sm">
							{t("dontHaveAccount")}{" "}
							<Link
								className="font-medium text-primary hover:underline"
								href="/signup"
							>
								{t("signUp")}
							</Link>
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
