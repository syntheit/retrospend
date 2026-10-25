"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
// x-guest-token is injected globally by the tRPC client (src/trpc/react.tsx)
import { toast } from "sonner";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";

type Phase = "confirm" | "deleting" | "done" | "no-session";

// The name the server writes in place of a deleted guest. Stored data, so it
// stays as is in every language.
const DELETED_GUEST_NAME = "Deleted Guest";

export default function GuestDeletePage() {
	const t = useTranslations("guestData");
	const router = useRouter();
	const [phase, setPhase] = useState<Phase>("confirm");
	useEffect(() => {
		const token = localStorage.getItem("guest_session_token");
		if (!token) {
			setPhase("no-session");
		}
	}, []);

	const deleteMyData = api.guest.deleteMyData.useMutation({
		onSuccess: () => {
			// Clear all guest localStorage keys
			localStorage.removeItem("guest_session_token");
			localStorage.removeItem("guest_project_id");
			localStorage.removeItem("guest_name");
			setPhase("done");
		},
		onError: (err) => {
			toast.error(err.message ?? t("deleteFailed"));
			setPhase("confirm");
		},
	});

	function handleConfirm() {
		setPhase("deleting");
		deleteMyData.mutate({ confirmation: true });
	}

	const bold = (chunks: React.ReactNode) => (
		<span className="text-fg font-medium">{chunks}</span>
	);

	// ── No session ──
	if (phase === "no-session") {
		return (
			<div className="bg-bg flex min-h-screen items-center justify-center p-4">
				<AuthPanel
					description={t("noSessionDescription")}
					title={t("noSessionTitle")}
				>
					<div className="flex justify-center">
						<Button kind="secondary" onClick={() => router.push("/")}>
							{t("goHome")}
						</Button>
					</div>
				</AuthPanel>
			</div>
		);
	}

	// ── Done ──
	if (phase === "done") {
		return (
			<div className="bg-bg flex min-h-screen items-center justify-center p-4">
				<AuthPanel
					description={t.rich("deletedDescription", {
						name: DELETED_GUEST_NAME,
						strong: bold,
					})}
					title={t("deletedTitle")}
				>
					<div className="flex justify-center">
						<Button kind="secondary" onClick={() => router.push("/")}>
							{t("goHome")}
						</Button>
					</div>
				</AuthPanel>
			</div>
		);
	}

	// ── Deleting (spinner) ──
	if (phase === "deleting") {
		return (
			<div className="bg-bg flex min-h-screen items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="text-fg-3 size-8 animate-spin" />
					<p className="text-fg-2 text-small">{t("deleting")}</p>
				</div>
			</div>
		);
	}

	// ── Confirm ──
	return (
		<div className="bg-bg flex min-h-screen items-center justify-center p-4">
			<AuthPanel title={t("confirmTitle")}>
				<div className="text-fg-2 text-small space-y-3">
					<p>{t("willDelete")}</p>
					<ul className="list-inside list-disc space-y-1 pl-1">
						<li>{t("deleteNameEmail")}</li>
						<li>{t("deleteSession")}</li>
						<li>{t("deleteParticipant")}</li>
					</ul>
					<p>
						{t.rich("expensesKept", {
							name: DELETED_GUEST_NAME,
							strong: bold,
						})}
					</p>
					<p className="text-danger font-medium">{t("cannotBeUndone")}</p>
				</div>
				<div className="mt-6 flex gap-3">
					<Button
						className="flex-1"
						kind="secondary"
						onClick={() => router.back()}
					>
						{t("cancel")}
					</Button>
					<Button className="flex-1" kind="danger" onClick={handleConfirm}>
						{t("deleteMyData")}
					</Button>
				</div>
			</AuthPanel>
		</div>
	);
}
