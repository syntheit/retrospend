"use client";

import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	passwordFirstIssue,
} from "@retrospend/api-contract";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { forgetKeyed } from "~/lib/protection/sign-in-secret";
import { api } from "~/trpc/react";

/**
 * Today's reset: a new password for an account that has no keys, or for one
 * whose keys the person chooses to remove. The server decides which, so this
 * form is the same either way.
 */
export function PlainResetForm({
	token,
	onBack,
}: {
	token: string;
	/** The way back to the choices, when the person came from them. */
	onBack?: () => void;
}) {
	const t = useTranslations("auth");
	const back = useTranslations("protection.enable");
	const router = useRouter();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");

	const resetMutation = api.auth.resetPassword.useMutation({
		onSuccess: async ({ email }) => {
			await forgetKeyed(email);
			toast.success(t("passwordUpdatedSuccessfully"));
			router.push("/login");
		},
		onError: (err) => {
			setError(err.message || t("failedToResetPassword"));
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!password || !confirmPassword) return;

		const issue = passwordFirstIssue(password);
		if (issue === "min") {
			setError(t("passwordMinLength", { min: PASSWORD_MIN_LENGTH }));
			return;
		}

		if (issue === "max") {
			setError(t("passwordMaxLength", { max: PASSWORD_MAX_LENGTH }));
			return;
		}

		if (issue === "complexity") {
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
				{onBack ? (
					<Button
						className="w-full"
						disabled={resetMutation.isPending}
						kind="ghost"
						onClick={onBack}
						type="button"
					>
						{back("back")}
					</Button>
				) : null}
			</form>
		</AuthPanel>
	);
}
