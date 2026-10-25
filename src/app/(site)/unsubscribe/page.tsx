"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
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
			<AuthPanel
				description={t("invalidLinkDescription")}
				title={t("invalidLink")}
			/>
		);
	}

	if (state === "success") {
		return (
			<AuthPanel
				description={
					<>
						{t("unsubscribedFrom", { type: typeLabel })} {t("manageInSettings")}{" "}
						<Link
							className="text-accent-strong rounded-ctl focus-visible:outline-brand text-small can-hover:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
							href="/settings"
						>
							{t("settings")}
						</Link>
						.
					</>
				}
				title={t("unsubscribed")}
			/>
		);
	}

	if (state === "error") {
		return (
			<AuthPanel
				description={errorMessage || t("errorDescription")}
				title={t("invalidLink")}
			>
				<div className="text-center">
					<Link
						className="text-accent-strong rounded-ctl focus-visible:outline-brand text-small can-hover:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
						href="/settings"
					>
						{t("managePreferencesLink")}
					</Link>
				</div>
			</AuthPanel>
		);
	}

	const handleUnsubscribe = async () => {
		setState("loading");
		try {
			await unsubscribe.mutateAsync({
				token,
				userId,
				type: type as Parameters<typeof unsubscribe.mutateAsync>[0]["type"],
			});
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
		<AuthPanel
			description={t("description", { type: typeLabel })}
			title={t("pageTitle")}
		>
			<div className="flex flex-col gap-3">
				<Button
					className="w-full"
					disabled={state === "loading"}
					kind="primary"
					loading={state === "loading"}
					onClick={handleUnsubscribe}
				>
					{t("unsubscribeFromType", { type: typeLabel })}
				</Button>
				<Button
					className="w-full"
					disabled={state === "loading"}
					kind="secondary"
					onClick={handleUnsubscribeAll}
				>
					{t("unsubscribeFromAll")}
				</Button>
				<p className="text-fg-3 text-small text-center">
					{t("manageInSettings")}{" "}
					<Link
						className="text-accent-strong rounded-ctl focus-visible:outline-brand text-small can-hover:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
						href="/settings"
					>
						{t("settings")}
					</Link>
					.
				</p>
			</div>
		</AuthPanel>
	);
}

export default function UnsubscribePage() {
	return (
		<div className="bg-bg flex min-h-screen items-center justify-center px-4">
			<Suspense
				fallback={
					<div className="flex items-center justify-center p-8">
						<Loader2 className="text-fg-3 size-8 animate-spin" />
					</div>
				}
			>
				<UnsubscribeInner />
			</Suspense>
		</div>
	);
}
