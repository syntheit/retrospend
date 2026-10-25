"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

function VerifyEmailInner() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const [status, setStatus] = useState<"loading" | "success" | "error">(
		"loading",
	);
	const [errorMsg, setErrorMsg] = useState<string>("");

	const verifyMutation = api.auth.verifyEmail.useMutation({
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
			setErrorMsg("No verification token provided.");
			return;
		}

		if (
			status === "loading" &&
			!verifyMutation.isPending &&
			!verifyMutation.isError &&
			!verifyMutation.isSuccess
		) {
			verifyMutation.mutate({ token });
		}
	}, [token, verifyMutation, status]);

	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{status === "loading" && (
				<AuthPanel
					busy
					description="Verifying your Retrospend account email address"
					title="Email verification"
				/>
			)}
			{status === "success" && (
				<AuthPanel
					description="Your account is now fully verified and ready to use."
					title="Email verified"
					tone="positive"
				>
					<Button asChild className="w-full" kind="primary">
						<Link href="/">Continue to app</Link>
					</Button>
				</AuthPanel>
			)}
			{status === "error" && (
				<AuthPanel
					description={errorMsg || "An unknown error occurred."}
					title="Verification failed"
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

export default function VerifyEmailPage() {
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
			<VerifyEmailInner />
		</Suspense>
	);
}
