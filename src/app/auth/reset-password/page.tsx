"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

function ResetPasswordInner() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const router = useRouter();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");

	const resetMutation = api.auth.resetPassword.useMutation({
		onSuccess: () => {
			toast.success("Password updated successfully!");
			router.push("/login");
		},
		onError: (err) => {
			setError(
				err.message || "Failed to reset password. The link may have expired.",
			);
		},
	});

	if (!token) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center justify-center space-y-4 py-8">
						<div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
							<AlertCircle className="h-10 w-10 text-red-600 dark:text-red-500" />
						</div>
						<div className="space-y-2 text-center">
							<h3 className="font-semibold text-lg text-red-600 dark:text-red-400">
								Invalid Link
							</h3>
							<p className="text-muted-foreground text-sm">
								No reset token provided. Please request a new link.
							</p>
						</div>
						<Button asChild className="w-full">
							<Link href="/login">Return to Login</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!password || !confirmPassword) return;

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		if (password.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}

		setError("");
		resetMutation.mutate({ token, newPassword: password });
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						Set New Password
					</CardTitle>
					<CardDescription className="text-center">
						Please choose a new password for your account
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<Label htmlFor="password">New Password</Label>
							<Input
								disabled={resetMutation.isPending}
								id="password"
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Enter new password"
								required
								type="password"
								value={password}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="confirmPassword">Confirm Password</Label>
							<Input
								disabled={resetMutation.isPending}
								id="confirmPassword"
								onChange={(e) => setConfirmPassword(e.target.value)}
								placeholder="Confirm new password"
								required
								type="password"
								value={confirmPassword}
							/>
						</div>

						{error && (
							<div className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400">
								<AlertCircle className="h-4 w-4 shrink-0" />
								<span>{error}</span>
							</div>
						)}

						<Button
							className="w-full"
							disabled={resetMutation.isPending}
							type="submit"
						>
							{resetMutation.isPending ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Resetting Password...
								</>
							) : (
								"Confirm and Save"
							)}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-12">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
						</CardContent>
					</Card>
				</div>
			}
		>
			<ResetPasswordInner />
		</Suspense>
	);
}
