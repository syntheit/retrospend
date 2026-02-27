"use client";

import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
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
		<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						Email Verification
					</CardTitle>
					<CardDescription className="text-center">
						Verifying your Retrospend account email address
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col items-center justify-center space-y-6 py-6">
					{status === "loading" && (
						<>
							<Loader2 className="h-12 w-12 animate-spin text-primary" />
							<p className="text-muted-foreground">Verifying your email...</p>
						</>
					)}

					{status === "success" && (
						<>
							<div className="rounded-full bg-green-100 p-3 dark:bg-green-900/30">
								<CheckCircle className="h-12 w-12 text-green-600 dark:text-green-500" />
							</div>
							<div className="space-y-2 text-center">
								<h3 className="font-semibold text-lg">
									Email Verified Successfully!
								</h3>
								<p className="text-muted-foreground text-sm">
									Your account is now fully verified and ready to use.
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
								<AlertCircle className="h-12 w-12 text-red-600 dark:text-red-500" />
							</div>
							<div className="space-y-2 text-center">
								<h3 className="font-semibold text-lg text-red-600 dark:text-red-400">
									Verification Failed
								</h3>
								<p className="text-muted-foreground text-sm">
									{errorMsg || "An unknown error occurred."}
								</p>
							</div>
							<div className="flex w-full flex-col gap-2">
								<Button asChild className="w-full" variant="outline">
									<Link href="/">Return to App</Link>
								</Button>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export default function VerifyEmailPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-12">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
						</CardContent>
					</Card>
				</div>
			}
		>
			<VerifyEmailInner />
		</Suspense>
	);
}
