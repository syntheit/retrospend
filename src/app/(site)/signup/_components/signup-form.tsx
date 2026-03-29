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
					setInviteError("Invalid or expired invite code");
				}
			} catch (error) {
				setInviteState("error");
				handleError(error, "Failed to validate invite code");
			}
		},
		[utils],
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
			setError("Please enter a valid invite code first");
			setIsLoading(false);
			return;
		}

		if (enableLegalPages && !termsAccepted) {
			setError("You must agree to the Terms & Conditions and Privacy Policy");
			setIsLoading(false);
			return;
		}

		if (!username.trim()) {
			setError("Username is required");
			setIsLoading(false);
			return;
		}

		if (!/^[a-zA-Z0-9]+$/.test(username.trim())) {
			setError(
				"Username can only contain letters and numbers",
			);
			setIsLoading(false);
			return;
		}

		if (password.length < 8) {
			setError("Password must be at least 8 characters");
			setIsLoading(false);
			return;
		}

		if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
			setError(
				"Password must contain at least one uppercase letter, one lowercase letter, and one number",
			);
			setIsLoading(false);
			return;
		}

		if (password !== confirmPassword) {
			setError("Passwords don't match");
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
				setError(result.error.message || "Sign up failed");
			} else {
				const signInResult = await authClient.signIn.email({
					email: email.trim().toLowerCase(),
					password,
				});

				if (signInResult.error) {
					setError(
						signInResult.error.message ||
							"Account created but sign in failed. Please try signing in manually.",
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
					window.location.href = "/dashboard";
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
						Create Account
					</CardTitle>
					<CardDescription className="text-center">
						{showFeatures
							? "Sign up to access your shared expenses and unlock your full financial toolkit"
							: "Sign up for Retrospend to get started"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						{showFeatures && (
							<div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
								<div className="flex items-start gap-2">
									<Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
									<p className="font-medium text-primary text-sm">
										Your shared expenses will be automatically linked when you sign up with this email.
									</p>
								</div>
								<p className="text-muted-foreground text-sm">With your own account you can also:</p>
								<ul className="grid gap-1.5 text-muted-foreground text-sm">
									<li className="flex items-center gap-2">
										<Smartphone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Access from any device — your data follows you
									</li>
									<li className="flex items-center gap-2">
										<ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Secure account with password protection — never lose your data
									</li>
									<li className="flex items-center gap-2">
										<BarChart3 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Personal spending tracking with budgets and analytics
									</li>
									<li className="flex items-center gap-2">
										<TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Track your net worth and wealth over time
									</li>
									<li className="flex items-center gap-2">
										<Globe className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Multi-currency support with live exchange rates
									</li>
									<li className="flex items-center gap-2">
										<Receipt className="h-3.5 w-3.5 shrink-0 text-primary/70" />
										Import bank statements and scan receipts
									</li>
								</ul>
							</div>
						)}
						{inviteOnlyEnabled && (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<Label htmlFor="inviteCode">Invite Code</Label>
									{inviteState === "success" && (
										<Badge
											className="flex items-center gap-1"
											variant="default"
										>
											<CheckCircle className="h-3 w-3" />
											Accepted
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
											Enter your 8-character invite code
										</p>
									</div>
								)}

								{inviteState === "validating" && (
									<div className="flex items-center gap-2 rounded-md bg-muted p-3">
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
										<span className="text-sm">Validating invite code...</span>
									</div>
								)}

								{inviteState === "success" && (
									<div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 dark:bg-emerald-950">
										<CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
										<span className="text-emerald-700 text-sm dark:text-emerald-300">
											Invite accepted. You may now sign up.
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
							<Label htmlFor="fullName">Full Name</Label>
							<Input
								disabled={isLoading}
								id="fullName"
								onChange={(e) => setFullName(e.target.value)}
								placeholder="Enter your full name"
								required
								type="text"
								value={fullName}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								disabled={isLoading}
								id="email"
								onChange={(e) => setEmail(e.target.value)}
								placeholder="Enter your email"
								required
								type="email"
								value={email}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="username">Username</Label>
							<div className="relative">
								<span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
									@
								</span>
								<Input
									className="pl-7"
									disabled={isLoading}
									id="username"
									onChange={(e) => setUsername(e.target.value)}
									placeholder="Enter your username"
									required
									type="text"
									value={username}
								/>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<Input
								disabled={isLoading}
								id="password"
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Enter your password"
								required
								type="password"
								value={password}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<Input
								disabled={isLoading}
								id="confirmPassword"
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder="Confirm your password"
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
									I agree to the{" "}
									<Link
										className="text-primary hover:underline"
										href="/terms"
										target="_blank"
									>
										Terms & Conditions
									</Link>{" "}
									and{" "}
									<Link
										className="text-primary hover:underline"
										href="/privacy"
										target="_blank"
									>
										Privacy Policy
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
							{isLoading ? "Creating account..." : "Create Account"}
						</Button>
					</form>
					<div className="mt-4 text-center">
						<p className="text-muted-foreground text-sm">
							Already have an account?{" "}
							<Button
								className="h-auto p-0 font-medium text-primary hover:underline"
								onClick={() => router.push("/login")}
								type="button"
								variant="link"
							>
								Sign in
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
