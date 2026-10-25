"use client";

import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
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
		<div className="bg-background flex min-h-screen items-center justify-center px-4">
			<AuthPanel
				className="flex flex-col items-center justify-center space-y-6 py-6"
				description="Confirming your new email address"
				title="Email Change"
			>
				{status === "loading" && (
					<>
						<Loader2 className="text-primary h-12 w-12 animate-spin" />
						<p className="text-muted-foreground">
							Confirming your email change...
						</p>
					</>
				)}

				{status === "success" && (
					<>
						<div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
							<CheckCircle className="h-12 w-12 text-emerald-600 dark:text-emerald-500" />
						</div>
						<div className="space-y-2 text-center">
							<h3 className="text-lg font-semibold">
								Email Updated Successfully!
							</h3>
							<p className="text-muted-foreground text-sm">
								Your account email has been changed. You can now sign in with
								your new email address.
							</p>
						</div>
						<Button asChild className="w-full">
							<Link href="/">Continue to App</Link>
						</Button>
					</>
				)}

				{status === "error" && (
					<>
						<div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
							<AlertCircle className="text-destructive h-12 w-12" />
						</div>
						<div className="space-y-2 text-center">
							<h3 className="text-destructive text-lg font-semibold">
								Confirmation Failed
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

export default function ConfirmEmailPage() {
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
			<ConfirmEmailInner />
		</Suspense>
	);
}
