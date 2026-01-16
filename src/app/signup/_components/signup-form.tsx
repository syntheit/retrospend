"use client";

import { AlertCircle, CheckCircle } from "lucide-react";
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
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";
import { api } from "~/trpc/react";

type InviteState = "idle" | "validating" | "success" | "error";

function SignupFormInner() {
	const [email, setEmail] = useState("");
	const [fullName, setFullName] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const router = useRouter();
	const searchParams = useSearchParams();

	const [inviteCode, setInviteCode] = useState("");
	const [inviteState, setInviteState] = useState<InviteState>("idle");
	const [inviteError, setInviteError] = useState("");

	const utils = api.useUtils();
	const { data: settings } = api.settings.getInviteOnlyEnabled.useQuery();
	const inviteOnlyEnabled = settings?.inviteOnlyEnabled ?? false;

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
					document.cookie = `retro_invite_code=${code}; path=/; max-age=86400`;
				} else {
					setInviteState("error");
					setInviteError("Invalid or expired invite code");
				}
			} catch {
				setInviteState("error");
				setInviteError("Failed to validate invite code");
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

		if (password !== confirmPassword) {
			setError("Passwords don't match");
			setIsLoading(false);
			return;
		}

		if (!username.trim()) {
			setError("Username is required");
			setIsLoading(false);
			return;
		}

		try {
			const result = await authClient.signUp.email({
				email: email.trim(),
				password,
				name: fullName.trim(),
				// @ts-expect-error - username is a custom field configured in better-auth
				username: username.trim(),
			});

			if (result.error) {
				setError(result.error.message || "Sign up failed");
			} else {
				const signInResult = await authClient.signIn.email({
					email,
					password,
				});

				if (signInResult.error) {
					setError(
						signInResult.error.message ||
							"Account created but sign in failed. Please try signing in manually.",
					);
				} else {
					window.location.href = "/app";
				}
			}
		} catch {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const showInviteInput = inviteState === "idle" || inviteState === "error";

	return (
		<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						Create Account
					</CardTitle>
					<CardDescription className="text-center">
						Sign up for Retrospend to get started
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
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
									<div className="flex items-center gap-2 rounded-md bg-green-50 p-3 dark:bg-green-950">
										<CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
										<span className="text-green-700 text-sm dark:text-green-300">
											Invite accepted. You may now sign up.
										</span>
									</div>
								)}

								{inviteError && (
									<div className="flex items-center gap-2 rounded-md bg-red-50 p-3 dark:bg-red-950">
										<AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
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
							<Input
								disabled={isLoading}
								id="username"
								onChange={(e) => setUsername(e.target.value)}
								placeholder="Enter your username"
								required
								type="text"
								value={username}
							/>
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
						{error && (
							<div className="text-red-600 text-sm dark:text-red-400">
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
							<button
								className="font-medium text-primary hover:underline"
								onClick={() => router.push("/login")}
								type="button"
							>
								Sign in
							</button>
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

export function SignupForm() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-6">
							<div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						</CardContent>
					</Card>
				</div>
			}
		>
			<SignupFormInner />
		</Suspense>
	);
}
