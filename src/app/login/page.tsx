"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
import { Label } from "~/components/ui/label";
import { authClient } from "~/lib/auth-client";

export default function LoginPage() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const router = useRouter();
	const queryClient = useQueryClient();

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
				setError(result.error.message || "Login failed");
			} else {
				// Invalidate session query and redirect to app on success
				await queryClient.invalidateQueries({ queryKey: ["session"] });
				router.push("/app");
			}
		} catch (_) {
			setError("An unexpected error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4 bg-stone-50 dark:bg-stone-950">
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
							<button
								className="font-medium text-primary hover:underline"
								onClick={() => router.push("/signup")}
								type="button"
							>
								Sign up
							</button>
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
