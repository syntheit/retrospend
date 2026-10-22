"use client";

import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
// x-guest-token is injected globally by the tRPC client (src/trpc/react.tsx)
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
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

	// ── No session ──
	if (phase === "no-session") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
							<AlertTriangle className="h-8 w-8 text-muted-foreground" />
						</div>
						<h1 className="font-bold text-xl">{t("noSessionTitle")}</h1>
						<p className="text-muted-foreground text-sm">
							{t("noSessionDescription")}
						</p>
						<Button variant="outline" onClick={() => router.push("/")}>
							{t("goHome")}
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ── Done ──
	if (phase === "done") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<Card className="w-full max-w-md">
					<CardContent className="flex flex-col items-center gap-4 p-8 text-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
							<CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
						</div>
						<h1 className="font-bold text-xl">{t("deletedTitle")}</h1>
						<p className="text-muted-foreground text-sm">
							{t.rich("deletedDescription", {
								name: DELETED_GUEST_NAME,
								strong: (chunks) => (
									<span className="font-medium text-foreground">{chunks}</span>
								),
							})}
						</p>
						<Button variant="outline" onClick={() => router.push("/")}>
							{t("goHome")}
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	// ── Deleting (spinner) ──
	if (phase === "deleting") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
					<p className="text-muted-foreground text-sm">{t("deleting")}</p>
				</div>
			</div>
		);
	}

	// ── Confirm ──
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="pb-2">
					<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
						<Trash2 className="h-7 w-7 text-destructive" />
					</div>
					<CardTitle>{t("confirmTitle")}</CardTitle>
				</CardHeader>

				<CardContent className="space-y-3 text-muted-foreground text-sm">
					<p>{t("willDelete")}</p>
					<ul className="list-inside list-disc space-y-1 pl-1">
						<li>{t("deleteNameEmail")}</li>
						<li>{t("deleteSession")}</li>
						<li>{t("deleteParticipant")}</li>
					</ul>
					<p>
						{t.rich("expensesKept", {
							name: DELETED_GUEST_NAME,
							strong: (chunks) => (
								<span className="font-medium text-foreground">{chunks}</span>
							),
						})}
					</p>
					<p className="font-medium text-destructive">{t("cannotBeUndone")}</p>
				</CardContent>

				<CardFooter className="flex gap-3">
					<Button
						className="flex-1"
						variant="outline"
						onClick={() => router.back()}
					>
						{t("cancel")}
					</Button>
					<Button
						className="flex-1"
						variant="destructive"
						onClick={handleConfirm}
					>
						{t("deleteMyData")}
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
