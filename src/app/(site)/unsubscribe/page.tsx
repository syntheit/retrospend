"use client";

import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
	EXPENSE_SPLIT: "New expense splits",
	VERIFICATION_REQUEST: "Verification requests",
	EXPENSE_EDITED: "Expense edits",
	EXPENSE_DELETED: "Expense deletions",
	SETTLEMENT_RECEIVED: "Settlement received",
	SETTLEMENT_CONFIRMED: "Settlement confirmed",
	SETTLEMENT_REJECTED: "Settlement rejected",
	PERIOD_CLOSED: "Billing period closed",
	PARTICIPANT_ADDED: "Added to a project",
	PAYMENT_REMINDER: "Payment reminders",
};

type State = "idle" | "loading" | "success" | "error" | "invalid";

function UnsubscribeInner() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token") ?? "";
	const userId = searchParams.get("userId") ?? "";
	const type = searchParams.get("type") ?? "";

	const [state, setState] = useState<State>("idle");
	const [errorMessage, setErrorMessage] = useState("");

	const unsubscribe = api.notification.unsubscribe.useMutation();

	const typeLabel = NOTIFICATION_TYPE_LABELS[type] ?? type;

	if (!token || !userId || !type) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<AlertCircle className="mx-auto h-10 w-10 text-destructive" />
					<CardTitle className="text-center">Invalid Link</CardTitle>
					<CardDescription className="text-center">
						This unsubscribe link is missing required parameters.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (state === "success") {
		return (
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<CheckCircle className="mx-auto h-10 w-10 text-emerald-500" />
					<CardTitle className="text-center">Unsubscribed</CardTitle>
					<CardDescription className="text-center">
						You&apos;ve been unsubscribed from <strong>{typeLabel}</strong>{" "}
						emails. You can manage all notification preferences in{" "}
						<Link
							className="text-primary hover:underline"
							href="/settings"
						>
							Settings
						</Link>
						.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (state === "error") {
		return (
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<AlertCircle className="mx-auto h-10 w-10 text-destructive" />
					<CardTitle className="text-center">Invalid Link</CardTitle>
					<CardDescription className="text-center">
						{errorMessage || "This unsubscribe link is invalid or has been tampered with."}
					</CardDescription>
				</CardHeader>
				<CardContent className="text-center">
					<Link
						className="text-sm text-primary hover:underline"
						href="/settings"
					>
						Manage preferences in Settings
					</Link>
				</CardContent>
			</Card>
		);
	}

	const handleUnsubscribe = async () => {
		setState("loading");
		try {
			await unsubscribe.mutateAsync({ token, userId, type: type as Parameters<typeof unsubscribe.mutateAsync>[0]["type"] });
			setState("success");
		} catch (err) {
			setState("error");
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to unsubscribe. The link may be invalid.",
			);
		}
	};

	const handleUnsubscribeAll = () => {
		window.location.href = "/settings";
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader className="space-y-1">
				<CardTitle className="text-center">Unsubscribe</CardTitle>
				<CardDescription className="text-center">
					Unsubscribe from <strong>{typeLabel}</strong> emails?
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Button
					className="w-full"
					disabled={state === "loading"}
					onClick={handleUnsubscribe}
				>
					{state === "loading" ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Unsubscribing...
						</>
					) : (
						`Unsubscribe from ${typeLabel}`
					)}
				</Button>
				<Button
					className="w-full"
					disabled={state === "loading"}
					onClick={handleUnsubscribeAll}
					variant="outline"
				>
					Unsubscribe from all notification emails
				</Button>
				<p className="text-center text-muted-foreground text-xs">
					You can manage all notification preferences in{" "}
					<Link className="text-primary hover:underline" href="/settings">
						Settings
					</Link>
					.
				</p>
			</CardContent>
		</Card>
	);
}

export default function UnsubscribePage() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<Suspense
				fallback={
					<Card className="w-full max-w-md">
						<CardContent className="flex items-center justify-center p-8">
							<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						</CardContent>
					</Card>
				}
			>
				<UnsubscribeInner />
			</Suspense>
		</div>
	);
}
