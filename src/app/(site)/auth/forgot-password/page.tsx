"use client";

import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						{t("resetPassword")}
					</CardTitle>
					<CardDescription className="text-center">
						{t("resetPasswordDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{status === "success" ? (
						<div className="flex flex-col items-center justify-center space-y-4 py-4">
							<div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
								<CheckCircle className="h-10 w-10 text-emerald-600 dark:text-emerald-500" />
							</div>
							<div className="space-y-2 text-center">
								<h3 className="font-semibold">{t("resetLinkSent")}</h3>
								<p className="text-muted-foreground text-sm">
									{t("resetLinkSentDescription")}
								</p>
							</div>
							<Button asChild className="mt-4 w-full" variant="outline">
								<Link href="/login">{t("returnToLogin")}</Link>
							</Button>
						</div>
					) : (
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
								<div className="flex items-center gap-2 text-destructive text-sm">
									<AlertCircle className="h-4 w-4" />
									<span>{t("failedToRequestReset")}</span>
								</div>
							)}

							<Button
								className="w-full"
								disabled={status === "loading"}
								type="submit"
							>
								{status === "loading" ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("sendingLink")}
									</>
								) : (
									t("sendResetLink")
								)}
							</Button>

							<div className="mt-4 text-center">
								<Link
									className="text-muted-foreground text-sm hover:underline"
									href="/login"
								>
									{t("backToLogin")}
								</Link>
							</div>
						</form>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
