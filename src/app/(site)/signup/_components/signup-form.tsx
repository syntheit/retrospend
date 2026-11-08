"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { handleError } from "~/lib/handle-error";
import { CURRENT_POLICY_VERSION } from "~/lib/policy-version";
import { api } from "~/trpc/react";
import { HomeCurrencyField, useHomeCurrency } from "./home-currency-field";
import { InviteCodeField, useInviteCode } from "./invite-code-field";
import { SignupFeatures } from "./signup-features";
import { signupError } from "./signup-validation";

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
			: "/home";

	const invite = useInviteCode();

	const { data: settings } = api.settings.getInviteOnlyEnabled.useQuery();
	const inviteOnlyEnabled = settings?.inviteOnlyEnabled ?? false;
	const recordConsent = api.auth.recordConsent.useMutation();
	const saveSettings = api.settings.updateGeneral.useMutation();
	const [homeCurrency, setHomeCurrency] = useHomeCurrency();

	// Pre-fill from query params (guest upgrade flow)
	useEffect(() => {
		const emailParam = searchParams.get("email");
		const nameParam = searchParams.get("name");
		if (emailParam && !email) setEmail(emailParam);
		if (nameParam && !fullName) setFullName(nameParam);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError("");

		const invalid = signupError({
			inviteRequired: inviteOnlyEnabled,
			inviteAccepted: invite.inviteState === "success",
			termsRequired: enableLegalPages,
			termsAccepted,
			username,
			password,
			confirmPassword,
		});
		if (invalid) {
			setError(t(invalid));
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
						signInResult.error.message || t("accountCreatedSignInFailed"),
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
					// Every account starts in USD: only another choice is written.
					if (homeCurrency !== "USD") {
						try {
							await saveSettings.mutateAsync({ homeCurrency });
						} catch {
							// Non-fatal: Settings and Home can set it later
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

	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				description={
					showFeatures ? t("signUpSharedDescription") : t("signUpDescription")
				}
				title={t("createAccount")}
			>
				<form className="space-y-4" onSubmit={handleSubmit}>
					{showFeatures && <SignupFeatures />}
					{inviteOnlyEnabled && <InviteCodeField {...invite} />}

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
							<span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
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
					<HomeCurrencyField
						disabled={isLoading}
						onChange={setHomeCurrency}
						value={homeCurrency}
					/>
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
								className="text-sm leading-none font-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
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
					{error && <div className="text-destructive text-sm">{error}</div>}
					<Button className="w-full" disabled={isLoading} type="submit">
						{isLoading ? t("creatingAccount") : t("createAccount")}
					</Button>
				</form>
				<div className="mt-4 text-center">
					<p className="text-muted-foreground text-sm">
						{t("alreadyHaveAccount")}{" "}
						<Button
							className="text-primary h-auto p-0 font-medium hover:underline"
							onClick={() =>
								router.push(
									signupRedirectTo === "/home"
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
			</AuthPanel>
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
				<div className="bg-background flex min-h-screen items-center justify-center">
					<div className="flex w-full max-w-md items-center justify-center p-6">
						<div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
					</div>
				</div>
			}
		>
			<SignupFormInner enableLegalPages={enableLegalPages} />
		</Suspense>
	);
}
