"use client";

import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";

type State = "idle" | "loading" | "success" | "error" | "invalid";

function UnsubscribeInner() {
	const t = useTranslations("unsubscribe");
	const searchParams = useSearchParams();
	const token = searchParams.get("token") ?? "";
	const userId = searchParams.get("userId") ?? "";
	const type = searchParams.get("type") ?? "";

	const [state, setState] = useState<State>("idle");
	const [errorMessage, setErrorMessage] = useState("");

	const unsubscribe = api.notification.unsubscribe.useMutation();

	const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
		EXPENSE_SPLIT: t("notifExpenseSplit"),
		VERIFICATION_REQUEST: t("notifVerificationRequest"),
		EXPENSE_EDITED: t("notifExpenseEdited"),
		EXPENSE_DELETED: t("notifExpenseDeleted"),
		SETTLEMENT_RECEIVED: t("notifSettlementReceived"),
		SETTLEMENT_CONFIRMED: t("notifSettlementConfirmed"),
		SETTLEMENT_REJECTED: t("notifSettlementRejected"),
		PERIOD_CLOSED: t("notifPeriodClosed"),
		PARTICIPANT_ADDED: t("notifParticipantAdded"),
		PAYMENT_REMINDER: t("notifPaymentReminder"),
	};

	const typeLabel = NOTIFICATION_TYPE_LABELS[type] ?? type;

	if (!token || !userId || !type) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader className="space-y-1">
					<AlertCircle className="mx-auto h-10 w-10 text-destructive" />
					<CardTitle className="text-center">{t("invalidLink")}</CardTitle>
					<CardDescription className="text-center">
						{t("invalidLinkDescription")}
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
					<CardTitle className="text-center">{t("unsubscribed")}</CardTitle>
					<CardDescription className="text-center">
						{t("unsubscribedFrom", { type: typeLabel })}{" "}
						{t("manageInSettings")}{" "}
						<Link
							className="text-primary hover:underline"
							href="/settings"
						>
							{t("settings")}
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
					<CardTitle className="text-center">{t("invalidLink")}</CardTitle>
					<CardDescription className="text-center">
						{errorMessage || t("errorDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent className="text-center">
					<Link
						className="text-sm text-primary hover:underline"
						href="/settings"
					>
						{t("managePreferencesLink")}
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
				err instanceof Error ? err.message : t("errorDescription"),
			);
		}
	};

	const handleUnsubscribeAll = () => {
		window.location.href = "/settings";
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader className="space-y-1">
				<CardTitle className="text-center">{t("pageTitle")}</CardTitle>
				<CardDescription className="text-center">
					{t("description", { type: typeLabel })}
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
							{t("unsubscribing")}
						</>
					) : (
						t("unsubscribeFromType", { type: typeLabel })
					)}
				</Button>
				<Button
					className="w-full"
					disabled={state === "loading"}
					onClick={handleUnsubscribeAll}
					variant="outline"
				>
					{t("unsubscribeFromAll")}
				</Button>
				<p className="text-center text-muted-foreground text-xs">
					{t("manageInSettings")}{" "}
					<Link className="text-primary hover:underline" href="/settings">
						{t("settings")}
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
