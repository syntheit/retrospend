"use client";

import {
	AlertCircle,
	BarChart3,
	CheckCircle,
	Globe,
	Info,
	Receipt,
	ShieldCheck,
	Smartphone,
	TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";
import { CURRENT_POLICY_VERSION } from "~/lib/policy-version";
import { api } from "~/trpc/react";

type InviteState = "idle" | "validating" | "success" | "error";

function SignupFormInner({ enableLegalPages }: { enableLegalPages: boolean }) {
	const t = useTranslations("auth");
	const [email, setEmail] = useState("");
	const [fullName, setFullName] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const router = useRouter();
	const searchParams = useSearchParams();

	const isUpgrade = searchParams.get("upgrade") === "true";
	const isInvited = searchParams.get("invited") === "true";
	const showFeatures = isUpgrade || isInvited;

	// Post-signup destination: honour a same-origin `redirect` (e.g. a claim
	// link that bounced through auth), otherwise land on the dashboard.
	const redirectParam = searchParams.get("redirect");
	const signupRedirectTo =
		redirectParam &&
		redirectParam.startsWith("/") &&
		!redirectParam.startsWith("//")
			? redirectParam
			: "/dashboard";

	const [inviteCode, setInviteCode] = useState("");
	const [inviteState, setInviteState] = useState<InviteState>("idle");
	const [inviteError, setInviteError] = useState("");

	const utils = api.useUtils();
	const { data: settings } = api.settings.getInviteOnlyEnabled.useQuery();
	const inviteOnlyEnabled = settings?.inviteOnlyEnabled ?? false;
	const recordConsent = api.auth.recordConsent.useMutation();

	// Pre-fill from query params (guest upgrade flow)
	useEffect(() => {
		const emailParam = searchParams.get("email");
		const nameParam = searchParams.get("name");
		if (emailParam && !email) setEmail(emailParam);
		if (nameParam && !fullName) setFullName(nameParam);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const validateInviteCode = useCallback(
		async (code: string) => {
			if (code.length !== 8) return;

			setInviteState("validating");
			setInviteError("");

			try {
				const result = await utils.invite.validate.fetch({ code });

				if (result.valid) {
					setInviteState("success");
					// biome-ignore lint/suspicious/noDocumentCookie: Cookie must be set client-side for better-auth server-side validation
					document.cookie = `retro_invite_code=${code}; path=/; max-age=86400; Secure; SameSite=Strict`;
				} else {
					setInviteState("error");
					setInviteError(t("invalidOrExpiredInviteCode"));
				}
			} catch (error) {
				setInviteState("error");
				handleError(error, "Failed to validate invite code");
			}
		},
		[utils, t],
	);

	useEffect(() => {
		const codeParam = searchParams.get("code");
		if (codeParam && inviteState === "idle") {
			const uppercaseCode = codeParam.toUpperCase();
			setInviteCode(uppercaseCode);
			validateInviteCode(uppercaseCode);
		}
	}, [searchParams, inviteState, validateInviteCode]);

	const handleInviteCodeChange = (value: string) => {
		const uppercaseValue = value.toUpperCase();
		setInviteCode(uppercaseValue);
		setInviteError("");

		if (uppercaseValue.length === 8) {
			validateInviteCode(uppercaseValue);
		} else if (inviteState !== "idle") {
			setInviteState("idle");
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		if (inviteOnlyEnabled && inviteState !== "success") {
			setError(t("pleaseEnterValidInviteCode"));
			setIsLoading(false);
			return;
		}

		if (enableLegalPages && !termsAccepted) {
			setError(t("mustAgreeToTerms"));
			setIsLoading(false);
			return;
		}

		if (!username.trim()) {
			setError(t("usernameRequired"));
			setIsLoading(false);
			return;
		}

		if (!/^[a-zA-Z0-9]+$/.test(username.trim())) {
			setError(
				t("usernameAlphanumericOnly"),
			);
			setIsLoading(false);
			return;
		}

		if (password.length < 8) {
			setError(t("passwordMinLength"));
			setIsLoading(false);
			return;
		}

		if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
			setError(
				t("passwordComplexity"),
			);
			setIsLoading(false);
			return;
		}

		if (password !== confirmPassword) {
			setError(t("passwordsDontMatch"));
			setIsLoading(false);
			return;
		}

		try {
			const result = await authClient.signUp.email({
				email: email.trim().toLowerCase(),
				password,
				name: fullName.trim(),
				// @ts-expect-error - username is a custom field configured in better-auth
				username: username.trim().toLowerCase(),
			});

			if (result.error) {
				setError(result.error.message || t("signUpFailed"));
			} else {
				const signInResult = await authClient.signIn.email({
					email: email.trim().toLowerCase(),
					password,
				});

				if (signInResult.error) {
					setError(
						signInResult.error.message ||
							t("accountCreatedSignInFailed"),
					);
				} else {
					// Record consent after successful signup + signin
					if (enableLegalPages && termsAccepted) {
						try {
							await recordConsent.mutateAsync({
								consentVersion: CURRENT_POLICY_VERSION,
							});
						} catch {
							// Non-fatal: consent recording failure should not block signup
						}
					}
					window.location.href = signupRedirectTo;
				}
			}
		} catch (error) {
			handleError(error, "An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const showInviteInput = inviteState === "idle" || inviteState === "error";

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						{t("createAccount")}
					</CardTitle>
					<CardDescription className="text-center">
						{showFeatures
							? t("signUpSharedDescription")
							: t("signUpDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						{showFeatures && (
							<div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
								<div className="flex items-start gap-2">
									<Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
									<p className="font-medium text-primary text-sm">
										{t("sharedExpensesAutoLinked")}
									</p>
								</div>
								<p className="text-muted-foreground text-sm">{t("withYourOwnAccount")}</p>
								<ul className="grid gap-1.5 text-muted-foreground text-sm">
									<li className="flex items-center gap-2">
										<Smartphone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureAccessAnyDevice")}
									</li>
									<li className="flex items-center gap-2">
										<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureSecureAccount")}
									</li>
									<li className="flex items-center gap-2">
										<BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureSpendingTracking")}
									</li>
									<li className="flex items-center gap-2">
										<TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureNetWorth")}
									</li>
									<li className="flex items-center gap-2">
										<Globe className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureMultiCurrency")}
									</li>
									<li className="flex items-center gap-2">
										<Receipt className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										{t("featureImportStatements")}
									</li>
								</ul>
							</div>
						)}
						{inviteOnlyEnabled && (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<Label htmlFor="inviteCode">{t("inviteCode")}</Label>
									{inviteState === "success" && (
										<Badge
											className="flex items-center gap-1"
											variant="default"
										>
											<CheckCircle className="h-3 w-3" />
											{t("accepted")}
										</Badge>
									)}
								</div>

								{showInviteInput && (
									<div className="space-y-2">
										<InputOTP
											maxLength={8}
											onChange={handleInviteCodeChange}
											value={inviteCode}
										>
											<InputOTPGroup>
												<InputOTPSlot index={0} />
												<InputOTPSlot index={1} />
												<InputOTPSlot index={2} />
												<InputOTPSlot index={3} />
												<InputOTPSlot index={4} />
												<InputOTPSlot index={5} />
												<InputOTPSlot index={6} />
												<InputOTPSlot index={7} />
											</InputOTPGroup>
										</InputOTP>
										<p className="text-muted-foreground text-xs">
											{t("enterInviteCode")}
										</p>
									</div>
								)}

								{inviteState === "validating" && (
									<div className="flex items-center gap-2 rounded-md bg-muted p-3">
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
										<span className="text-sm">{t("validatingInviteCode")}</span>
									</div>
								)}

								{inviteState === "success" && (
									<div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 dark:bg-emerald-950">
										<CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
										<span className="text-emerald-700 text-sm dark:text-emerald-300">
											{t("inviteAccepted")}
										</span>
									</div>
								)}

								{inviteError && (
									<div className="flex items-center gap-2 rounded-md bg-red-50 p-3 dark:bg-red-950">
										<AlertCircle className="h-4 w-4 text-destructive" />
										<span className="text-red-700 text-sm dark:text-red-300">
											{inviteError}
										</span>
									</div>
								)}
							</div>
						)}

						<div className="space-y-2">
							<Label htmlFor="fullName">{t("fullName")}</Label>
							<Input
								disabled={isLoading}
								id="fullName"
								onChange={(e) => setFullName(e.target.value)}
								placeholder={t("enterYourFullName")}
								required
								type="text"
								value={fullName}
							/>
						</div>
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
							<Label htmlFor="username">{t("username")}</Label>
							<div className="relative">
								<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
									@
								</span>
								<Input
									className="pl-7"
									disabled={isLoading}
									id="username"
									onChange={(e) => setUsername(e.target.value)}
									placeholder={t("enterYourUsername")}
									required
									type="text"
									value={username}
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">{t("password")}</Label>
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
						<div className="space-y-2">
							<Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
							<Input
								disabled={isLoading}
								id="confirmPassword"
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder={t("confirmYourPassword")}
								required
								type="password"
								value={confirmPassword}
							/>
						</div>
						{enableLegalPages && (
							<div className="flex items-center space-x-2 pt-2 pb-2">
								<Checkbox
									checked={termsAccepted}
									id="terms"
									onCheckedChange={(checked) =>
										setTermsAccepted(checked as boolean)
									}
								/>
								<Label
									className="font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
									htmlFor="terms"
								>
									{t("iAgreeTo")}{" "}
									<Link
										className="text-primary hover:underline"
										href="/terms"
										target="_blank"
									>
										{t("termsAndConditions")}
									</Link>{" "}
									{t("and")}{" "}
									<Link
										className="text-primary hover:underline"
										href="/privacy"
										target="_blank"
									>
										{t("privacyPolicy")}
									</Link>
								</Label>
							</div>
						)}
						{error && (
							<div className="text-destructive text-sm">
								{error}
							</div>
						)}
						<Button className="w-full" disabled={isLoading} type="submit">
							{isLoading ? t("creatingAccount") : t("createAccount")}
						</Button>
					</form>
					<div className="mt-4 text-center">
						<p className="text-muted-foreground text-sm">
							{t("alreadyHaveAccount")}{" "}
							<Button
								className="h-auto p-0 font-medium text-primary hover:underline"
								onClick={() =>
									router.push(
										signupRedirectTo === "/dashboard"
											? "/login"
											: `/login?redirect=${encodeURIComponent(signupRedirectTo)}`,
									)
								}
								type="button"
								variant="link"
							>
								{t("signIn")}
							</Button>
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export function SignupForm({
	enableLegalPages,
}: {
	enableLegalPages: boolean;
}) {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background">
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-6">
							<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						</CardContent>
					</Card>
				</div>
			}
		>
			<SignupFormInner enableLegalPages={enableLegalPages} />
		</Suspense>
	);
}
