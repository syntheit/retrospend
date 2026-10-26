"use client";

import { Loader2 } from "lucide-react";
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
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{status === "loading" && (
				<AuthPanel
					busy
					description="Cancelling the email change request"
					title="Reverting email change"
				/>
			)}
			{status === "success" && (
				<AuthPanel
					description="The email change has been cancelled and your original email remains active. For security, all sessions have been signed out. If you didn't request this change, reset your password."
					title="Email change cancelled"
					tone="positive"
				>
					<div className="flex w-full flex-col gap-2">
						<Button asChild className="w-full" kind="primary">
							<Link href="/auth/forgot-password">Reset password</Link>
						</Button>
						<Button asChild className="w-full" kind="secondary">
							<Link href="/login">Sign in</Link>
						</Button>
					</div>
				</AuthPanel>
			)}
			{status === "error" && (
				<AuthPanel
					description={errorMsg || "An unknown error occurred."}
					title="Revert failed"
					tone="danger"
				>
					<Button asChild className="w-full" kind="secondary">
						<Link href="/">Return to app</Link>
					</Button>
				</AuthPanel>
			)}
		</div>
	);
}

export default function RevertEmailPage() {
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
			<RevertEmailInner />
		</Suspense>
	);
}
