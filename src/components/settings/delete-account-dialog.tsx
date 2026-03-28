"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
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
			toast.success("Account deleted");
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
			setPasswordError("Password is required");
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
								<ResponsiveDialogTitle>Delete Account</ResponsiveDialogTitle>
							</div>
							<ResponsiveDialogDescription>
								This will permanently delete your account and all your personal
								data. This action cannot be undone.
							</ResponsiveDialogDescription>
						</ResponsiveDialogHeader>

						<div className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="delete-password">
									Enter your password to continue
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
									placeholder="Your password"
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
								Cancel
							</Button>
							<Button
								disabled={!password.trim()}
								onClick={handleContinue}
								variant="destructive"
							>
								Continue
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
								<ResponsiveDialogTitle>Before your account is deleted</ResponsiveDialogTitle>
							</div>
							<ResponsiveDialogDescription>
								Review what will happen to your shared data.
							</ResponsiveDialogDescription>
						</ResponsiveDialogHeader>

						<div className="space-y-3 text-sm">
							{preview.isPending ? (
								<p className="text-muted-foreground">Loading summary...</p>
							) : preview.isError ? (
								<p className="text-destructive text-sm">
									Could not load deletion summary. You can still proceed.
								</p>
							) : hasSharedActivity ? (
								<ul className="space-y-2">
									{data.projectsToTransfer.map((p) => (
										<li key={p.id} className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												<span className="font-medium">{p.name}</span>
												{"; owner role will transfer to "}
												<span className="font-medium">{p.newOrganizerName}</span>
											</span>
										</li>
									))}
									{data.projectsToDelete.map((p) => (
										<li key={p.id} className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												<span className="font-medium">{p.name}</span>
												{" (solo project) will be deleted"}
											</span>
										</li>
									))}
									{data.settlementsToAutoConfirm > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{data.settlementsToAutoConfirm}{" "}
												{data.settlementsToAutoConfirm === 1
													? "pending settlement"
													: "pending settlements"}{" "}
												will be auto-confirmed
											</span>
										</li>
									)}
									{data.settlementsToCancel > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{data.settlementsToCancel}{" "}
												{data.settlementsToCancel === 1
													? "unconfirmed settlement"
													: "unconfirmed settlements"}{" "}
												will be cancelled
											</span>
										</li>
									)}
									{data.verificationsToAutoAccept > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												{data.verificationsToAutoAccept}{" "}
												{data.verificationsToAutoAccept === 1
													? "pending verification"
													: "pending verifications"}{" "}
												will be auto-accepted
											</span>
										</li>
									)}
									{data.sharedTransactionsToAnonymize > 0 && (
										<li className="flex gap-2">
											<span className="mt-0.5 shrink-0 text-muted-foreground">
												•
											</span>
											<span>
												Your name will appear as{" "}
												<span className="font-medium">Deleted User</span> in{" "}
												{data.sharedTransactionsToAnonymize} shared{" "}
												{data.sharedTransactionsToAnonymize === 1
													? "transaction"
													: "transactions"}
											</span>
										</li>
									)}
								</ul>
							) : (
								<p className="text-muted-foreground">
									You have no shared expense activity. Only your personal data
									will be deleted.
								</p>
							)}

							<Separator />

							<p className="text-muted-foreground">
								Your personal data (expenses, budgets, assets, settings) will
								be permanently deleted.{" "}
								<span className="font-medium text-foreground">
									This cannot be undone.
								</span>
							</p>
						</div>

						<ResponsiveDialogFooter>
							<Button
								onClick={() => handleClose(false)}
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={deleteAccount.isPending}
								onClick={handleConfirmDelete}
								variant="destructive"
							>
								{deleteAccount.isPending
									? "Deleting..."
									: "Delete My Account"}
							</Button>
						</ResponsiveDialogFooter>
					</>
				)}
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
