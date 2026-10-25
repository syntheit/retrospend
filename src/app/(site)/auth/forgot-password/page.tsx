"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

export default function ForgotPasswordPage() {
	const t = useTranslations("auth");
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<
		"idle" | "loading" | "success" | "error"
	>("idle");

	const requestResetMutation = api.auth.requestPasswordReset.useMutation({
		onSuccess: () => {
			setStatus("success");
		},
		onError: (error) => {
			setStatus("error");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) return;

		setStatus("loading");
		requestResetMutation.mutate({ email });
	};

	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{status === "success" ? (
				<AuthPanel
					description={t("resetLinkSentDescription")}
					title={t("resetLinkSent")}
					tone="positive"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/login">{t("returnToLogin")}</Link>
					</Button>
				</AuthPanel>
			) : (
				<AuthPanel
					description={t("resetPasswordDescription")}
					title={t("resetPassword")}
				>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<Label htmlFor="email">{t("email")}</Label>
							<Input
								disabled={status === "loading"}
								id="email"
								onChange={(e) => setEmail(e.target.value)}
								placeholder="example@example.com"
								required
								type="email"
								value={email}
							/>
						</div>

						{status === "error" && (
							<p className="text-danger text-small" role="alert">
								{t("failedToRequestReset")}
							</p>
						)}

						<Button
							className="w-full"
							disabled={status === "loading"}
							kind="primary"
							loading={status === "loading"}
							type="submit"
						>
							{t("sendResetLink")}
						</Button>

						<div className="mt-4 text-center">
							<Link
								className="text-fg-2 text-small can-hover:hover:underline"
								href="/login"
							>
								{t("backToLogin")}
							</Link>
						</div>
					</form>
				</AuthPanel>
			)}
		</div>
	);
}
