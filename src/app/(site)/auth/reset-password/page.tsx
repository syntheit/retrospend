"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

function ResetPasswordInner() {
	const t = useTranslations("auth");
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const router = useRouter();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");

	const resetMutation = api.auth.resetPassword.useMutation({
		onSuccess: () => {
			toast.success(t("passwordUpdatedSuccessfully"));
			router.push("/login");
		},
		onError: (err) => {
			setError(err.message || t("failedToResetPassword"));
		},
	});

	if (!token) {
		return (
			<div className="bg-background flex min-h-screen items-center justify-center px-4">
				<div className="flex w-full max-w-md flex-col items-center justify-center space-y-4 py-8">
					<div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
						<AlertCircle className="text-destructive h-10 w-10" />
					</div>
					<div className="space-y-2 text-center">
						<h3 className="text-destructive text-lg font-semibold">
							{t("invalidLink")}
						</h3>
						<p className="text-muted-foreground text-sm">
							{t("noResetTokenProvided")}
						</p>
					</div>
					<Button asChild className="w-full">
						<Link href="/login">{t("returnToLogin")}</Link>
					</Button>
				</div>
			</div>
		);
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!password || !confirmPassword) return;

		if (password.length < 8) {
			setError(t("passwordMinLength"));
			return;
		}

		if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
			setError(t("passwordComplexity"));
			return;
		}

		if (password !== confirmPassword) {
			setError(t("passwordsDoNotMatch"));
			return;
		}

		setError("");
		resetMutation.mutate({ token, newPassword: password });
	};

	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				description={t("setNewPasswordDescription")}
				title={t("setNewPassword")}
			>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor="password">{t("newPassword")}</Label>
						<Input
							disabled={resetMutation.isPending}
							id="password"
							onChange={(e) => setPassword(e.target.value)}
							placeholder={t("enterNewPassword")}
							required
							type="password"
							value={password}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
						<Input
							disabled={resetMutation.isPending}
							id="confirmPassword"
							onChange={(e) => setConfirmPassword(e.target.value)}
							placeholder={t("confirmNewPassword")}
							required
							type="password"
							value={confirmPassword}
						/>
					</div>

					{error && (
						<div className="text-destructive flex items-center gap-2 text-sm">
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
								{t("resettingPassword")}
							</>
						) : (
							t("confirmAndSave")
						)}
					</Button>
				</form>
			</AuthPanel>
		</div>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense
			fallback={
				<div className="bg-background flex min-h-screen items-center justify-center px-4">
					<div className="flex w-full max-w-md items-center justify-center p-12">
						<Loader2 className="text-primary h-8 w-8 animate-spin" />
					</div>
				</div>
			}
		>
			<ResetPasswordInner />
		</Suspense>
	);
}
