"use client";

import { AlertCircle, CheckCircle, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

function RevertEmailInner() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const [status, setStatus] = useState<"loading" | "success" | "error">(
		"loading",
	);
	const [errorMsg, setErrorMsg] = useState<string>("");

	const revertMutation = api.auth.revertEmailChange.useMutation({
		onSuccess: () => {
			setStatus("success");
		},
		onError: (error) => {
			setStatus("error");
			setErrorMsg(error.message);
		},
	});

	useEffect(() => {
		if (!token) {
			setStatus("error");
			setErrorMsg("No token provided.");
			return;
		}

		if (
			status === "loading" &&
			!revertMutation.isPending &&
			!revertMutation.isError &&
			!revertMutation.isSuccess
		) {
			revertMutation.mutate({ token });
		}
	}, [token, revertMutation, status]);

	return (
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				className="flex flex-col items-center justify-center space-y-6 py-6"
				description="Cancelling the email change request"
				title="Email Change Reverted"
			>
				{status === "loading" && (
					<>
						<Loader2 className="text-primary h-12 w-12 animate-spin" />
						<p className="text-muted-foreground">
							Cancelling the email change...
						</p>
					</>
				)}

				{status === "success" && (
					<>
						<div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
							<CheckCircle className="h-12 w-12 text-emerald-600 dark:text-emerald-500" />
						</div>
						<div className="space-y-2 text-center">
							<h3 className="text-lg font-semibold">Email Change Cancelled</h3>
							<p className="text-muted-foreground text-sm">
								The email change has been cancelled and your original email
								remains active.
							</p>
						</div>
						<div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
							<div className="flex items-start gap-3">
								<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
								<div className="space-y-1">
									<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
										Secure your account
									</p>
									<p className="text-sm text-amber-700 dark:text-amber-300">
										For security, all sessions have been signed out. If you
										didn&apos;t request this change, we recommend resetting your
										password.
									</p>
								</div>
							</div>
						</div>
						<div className="flex w-full flex-col gap-2">
							<Button asChild className="w-full">
								<Link href="/auth/forgot-password">Reset Password</Link>
							</Button>
							<Button asChild className="w-full" variant="outline">
								<Link href="/login">Sign In</Link>
							</Button>
						</div>
					</>
				)}

				{status === "error" && (
					<>
						<div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
							<AlertCircle className="text-destructive h-12 w-12" />
						</div>
						<div className="space-y-2 text-center">
							<h3 className="text-destructive text-lg font-semibold">
								Revert Failed
							</h3>
							<p className="text-muted-foreground text-sm">
								{errorMsg || "An unknown error occurred."}
							</p>
						</div>
						<Button asChild className="w-full" variant="outline">
							<Link href="/">Return to App</Link>
						</Button>
					</>
				)}
			</AuthPanel>
		</div>
	);
}

export default function RevertEmailPage() {
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
			<RevertEmailInner />
		</Suspense>
	);
}
