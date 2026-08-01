"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Input } from "~/components/ui/input";

// Relocated out of share-project-dialog.tsx so the People tab's role menu (and
// anything else that manages ownership) can reuse the same confirm-by-typing
// transfer dialog.
export function TransferOwnershipDialog({
	open,
	onOpenChange,
	isPending,
	onConfirm,
	participantName,
	projectName,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isPending: boolean;
	onConfirm: () => void;
	participantName: string;
	projectName: string;
}) {
	const t = useTranslations("projects");
	const [confirmText, setConfirmText] = useState("");
	const matches = confirmText === projectName;

	return (
		<AlertDialog
			open={open}
			onOpenChange={(v) => {
				if (!v) setConfirmText("");
				onOpenChange(v);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("transferOwnership")}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-3">
							<p>{t("transferOwnershipIntro", { name: participantName })}</p>
							<p>{t("transferOwnershipWarning")}</p>
							<p>{t("typeToConfirm", { name: projectName })}</p>
							<Input
								value={confirmText}
								onChange={(e) => setConfirmText(e.target.value)}
								placeholder={projectName}
								autoComplete="off"
							/>
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>
						{t("cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={!matches || isPending}
						onClick={(e) => {
							e.preventDefault();
							onConfirm();
						}}
						className="bg-destructive text-white hover:bg-destructive/90"
					>
						{isPending ? t("transferring") : t("transferOwnership")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
