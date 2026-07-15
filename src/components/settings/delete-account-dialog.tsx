"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { api } from "~/trpc/react";

interface DeleteAccountDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

type Step = "password" | "confirm";

export function DeleteAccountDialog({
	open,
	onOpenChange,
}: DeleteAccountDialogProps) {
	const t = useTranslations("settingsPage");
	const router = useRouter();
	const [step, setStep] = useState<Step>("password");
	const [password, setPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);

	const preview = api.user.previewAccountDeletion.useQuery(undefined, {
		enabled: open,
		staleTime: 60_000,
	});

	const deleteAccount = api.user.deleteAccount.useMutation({
		onSuccess: () => {
			toast.success(t("deleteAccountSuccess"));
			router.push("/login");
		},
		onError: (err) => {
			// Wrong password or other error - go back to password step
			setStep("password");
			setPasswordError(err.message);
		},
	});

	function handleClose(value: boolean) {
		if (!value) {
			// Reset state when closing
			setStep("password");
			setPassword("");
			setPasswordError(null);
		}
		onOpenChange(value);
	}

	function handleContinue() {
		if (!password.trim()) {
			setPasswordError(t("passwordRequired"));
			return;
		}
		setPasswordError(null);
		setStep("confirm");
	}

	function handleConfirmDelete() {
		deleteAccount.mutate({ password });
	}

	const data = preview.data;
	const hasSharedActivity =
		data &&
		(data.projectsToTransfer.length > 0 ||
			data.projectsToDelete.length > 0 ||
			data.settlementsToAutoConfirm > 0 ||
			data.settlementsToCancel > 0 ||
			data.verificationsToAutoAccept > 0 ||
			data.sharedTransactionsToAnonymize > 0);

	return (
		<ResponsiveDialog open={open} onOpenChange={handleClose}>
			<ResponsiveDialogContent className="max-w-md">
				{step === "password" ? (
					<>
						<ResponsiveDialogHeader>
							<div className="flex items-center gap-2">
								<div className="flex size-8 items-center justify-center rounded-full bg-destructive/10">
									<AlertTriangle className="size-4 text-destructive" />
								</div>
								<ResponsiveDialogTitle>{t("deleteAccountTitle")}</ResponsiveDialogTitle>
							</div>
							<ResponsiveDialogDescription>
								{t("deleteAccountDescription")}
							</ResponsiveDialogDescription>
						</ResponsiveDialogHeader>

						<div className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="delete-password">
									{t("enterPasswordToContinue")}
								</Label>
								<Input
									autoComplete="current-password"
									autoFocus
									id="delete-password"
									onChange={(e) => {
										setPassword(e.target.value);
										if (passwordError) setPasswordError(null);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleContinue();
									}}
									placeholder={t("yourPassword")}
									type="password"
									value={password}
								/>
								{passwordError && (
									<p className="text-destructive text-sm">{passwordError}</p>
								)}
							</div>
						</div>

						<ResponsiveDialogFooter>
							<Button
								onClick={() => handleClose(false)}
								variant="ghost"
							>
								{t("cancel")}
							</Button>
							<Button
								disabled={!password.trim()}
								onClick={handleContinue}
								variant="destructive"
							>
								{t("continue")}
							</Button>
						</ResponsiveDialogFooter>
					</>
				) : (
					<>
						<ResponsiveDialogHeader>
							<div className="flex items-center gap-2">
								<div className="flex size-8 items-center justify-center rounded-full bg-destructive/10">
									<AlertTriangle className="size-4 text-destructive" />
								</div>
								<ResponsiveDialogTitle>{t("beforeAccountDeleted")}</ResponsiveDialogTitle>
							</div>
							<ResponsiveDialogDescription>
								{t("reviewSharedData")}
							</ResponsiveDialogDescription>
						</ResponsiveDialogHeader>

						<div className="space-y-3 text-sm">
							{preview.isPending ? (
								<p className="text-muted-foreground">{t("loadingSummary")}</p>
							) : preview.isError ? (
								<p className="text-destructive text-sm">
									{t("couldNotLoadSummary")}
								</p>
							) : hasSharedActivity ? (
								<ul className="space-y-2">
									{data.projectsToTransfer.map((p) => (
										<li key={p.id} className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t.rich("projectTransferOwner", {
													projectName: p.name,
													newOwner: p.newOrganizerName,
													projectBold: (chunks) => <span className="font-medium">{chunks}</span>,
													ownerBold: (chunks) => <span className="font-medium">{chunks}</span>,
												})}
											</span>
										</li>
									))}
									{data.projectsToDelete.map((p) => (
										<li key={p.id} className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t.rich("projectSoloDelete", {
													projectName: p.name,
													bold: (chunks) => <span className="font-medium">{chunks}</span>,
												})}
											</span>
										</li>
									))}
									{data.settlementsToAutoConfirm > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t("settlementsAutoConfirm", { count: data.settlementsToAutoConfirm })}
											</span>
										</li>
									)}
									{data.settlementsToCancel > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t("settlementsCancel", { count: data.settlementsToCancel })}
											</span>
										</li>
									)}
									{data.verificationsToAutoAccept > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t("verificationsAutoAccept", { count: data.verificationsToAutoAccept })}
											</span>
										</li>
									)}
									{data.sharedTransactionsToAnonymize > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{t.rich("transactionsAnonymize", {
													count: data.sharedTransactionsToAnonymize,
													bold: (chunks) => <span className="font-medium">{chunks}</span>,
												})}
											</span>
										</li>
									)}
								</ul>
							) : (
								<p className="text-muted-foreground">
									{t("noSharedActivity")}
								</p>
							)}

							<Separator />

							<p className="text-muted-foreground">
								{t.rich("personalDataDeleted", {
									bold: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
								})}
							</p>
						</div>

						<ResponsiveDialogFooter>
							<Button
								onClick={() => handleClose(false)}
								variant="ghost"
							>
								{t("cancel")}
							</Button>
							<Button
								disabled={deleteAccount.isPending}
								onClick={handleConfirmDelete}
								variant="destructive"
							>
								{deleteAccount.isPending
									? t("deleting")
									: t("deleteMyAccount")}
							</Button>
						</ResponsiveDialogFooter>
					</>
				)}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
