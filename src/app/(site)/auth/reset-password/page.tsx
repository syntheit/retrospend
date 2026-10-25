"use client";

import { Loader2 } from "lucide-react";
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
			<div className="bg-bg flex min-h-screen items-center justify-center px-4">
				<AuthPanel
					description={t("noResetTokenProvided")}
					title={t("invalidLink")}
					tone="danger"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/login">{t("returnToLogin")}</Link>
					</Button>
				</AuthPanel>
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
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
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
						<p className="text-danger text-small" role="alert">
							{error}
						</p>
					)}

					<Button
						className="w-full"
						disabled={resetMutation.isPending}
						kind="primary"
						loading={resetMutation.isPending}
						type="submit"
					>
						{t("confirmAndSave")}
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
				<div className="bg-bg flex min-h-screen items-center justify-center px-4">
					<div className="flex w-full max-w-md items-center justify-center p-12">
						<Loader2 className="text-fg-3 size-8 animate-spin" />
					</div>
				</div>
			}
		>
			<ResetPasswordInner />
		</Suspense>
	);
}
