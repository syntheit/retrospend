"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

function ConfirmEmailInner() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const [status, setStatus] = useState<"loading" | "success" | "error">(
		"loading",
	);
	const [errorMsg, setErrorMsg] = useState<string>("");

	const confirmMutation = api.auth.confirmEmailChange.useMutation({
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
			!confirmMutation.isPending &&
			!confirmMutation.isError &&
			!confirmMutation.isSuccess
		) {
			confirmMutation.mutate({ token });
		}
	}, [token, confirmMutation, status]);

	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			{status === "loading" && (
				<AuthPanel
					busy
					description="Confirming your new email address"
					title="Email change"
				/>
			)}
			{status === "success" && (
				<AuthPanel
					description="Your account email has been changed. You can now sign in with your new email address."
					title="Email updated"
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
					title="Confirmation failed"
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

export default function ConfirmEmailPage() {
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
			<ConfirmEmailInner />
		</Suspense>
	);
}
