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
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CardTitle className="text-center font-bold text-2xl">
						Email Change
					</CardTitle>
					<CardDescription className="text-center">
						Confirming your new email address
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col items-center justify-center space-y-6 py-6">
					{status === "loading" && (
						<>
							<Loader2 className="h-12 w-12 animate-spin text-primary" />
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
								<h3 className="font-semibold text-lg">
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
								<AlertCircle className="h-12 w-12 text-destructive" />
							</div>
							<div className="space-y-2 text-center">
								<h3 className="font-semibold text-lg text-destructive">
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
				</CardContent>
			</Card>
		</div>
	);
}

export default function ConfirmEmailPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background px-4">
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-12">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
						</CardContent>
					</Card>
				</div>
			}
		>
			<ConfirmEmailInner />
		</Suspense>
	);
}
