"use client";

import Link from "next/link";
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
				email,
				password,
			});

			if (result.error) {
				// Check if 2FA is required
				if (
					result.error.status === 403 ||
					result.error.message?.toLowerCase().includes("two factor")
				) {
					setShow2FA(true);
					setError("");
				} else {
					setError(result.error.message || "Login failed");
				}
			} else {
				// Some versions of better-auth return it in data
				if (
					(result.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect
				) {
					setShow2FA(true);
					setError("");
				} else {
					window.location.href = "/app";
				}
			}
		} catch (_) {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const handleVerify2FA = async (e: React.FormEvent) => {
		e.preventDefault();
		if (totpCode.length !== 6) return;
		setIsLoading(true);
		setError("");

		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: totpCode,
			});

			if (result.error) {
				setError(result.error.message || "Invalid authenticator code");
			} else {
				window.location.href = "/app";
			}
		} catch (_) {
			setError("An unexpected error occurred during verification");
		} finally {
			setIsLoading(false);
		}
	};

	if (show2FA) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
				<Card className="w-full max-w-md">
					<CardHeader className="space-y-1">
						<CardTitle className="text-center font-bold text-2xl">
							Two-Factor Authentication
						</CardTitle>
						<CardDescription className="text-center">
							Enter the 6-digit code from your authenticator app
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							className="flex flex-col items-center space-y-6"
							onSubmit={handleVerify2FA}
						>
							<div className="space-y-2">
								<InputOTP maxLength={6} onChange={setTotpCode} value={totpCode}>
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
								<div className="text-red-600 text-sm dark:text-red-400">
									{error}
								</div>
							)}

							<Button
								className="w-full"
								disabled={isLoading || totpCode.length !== 6}
								type="submit"
							>
								{isLoading ? "Verifying..." : "Verify Code"}
							</Button>

							<div className="mt-4 text-center text-sm">
								<button
									className="text-muted-foreground hover:underline"
									onClick={() => {
										setShow2FA(false);
										setTotpCode("");
									}}
									type="button"
								>
									Back to login
								</button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						Welcome to Retrospend
					</CardTitle>
					<CardDescription className="text-center">
						Sign in to your account to continue
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
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
							<div className="flex items-center justify-between">
								<Label htmlFor="password">Password</Label>
								{appFeatures?.isEmailEnabled && (
									<Link
										className="font-medium text-primary text-sm hover:underline"
										href="/auth/forgot-password"
									>
										Forgot your password?
									</Link>
								)}
							</div>
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
						{error && (
							<div className="text-red-600 text-sm dark:text-red-400">
								{error}
							</div>
						)}
						<Button className="w-full" disabled={isLoading} type="submit">
							{isLoading ? "Signing in..." : "Sign In"}
						</Button>
					</form>
					<div className="mt-4 text-center">
						<p className="text-muted-foreground text-sm">
							Don't have an account?{" "}
							<Link
								className="font-medium text-primary hover:underline"
								href="/signup"
							>
								Sign up
							</Link>
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
